use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jni::{
    objects::{JClass, JString},
    sys::jstring,
    JNIEnv,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use snow::{params::NoiseParams, Builder, HandshakeState, TransportState};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use zeroize::Zeroize;

const PAIRING_PATTERN: &str = "Noise_XK_25519_ChaChaPoly_BLAKE2s";
const DEVICE_PATTERN: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2s";
const MAX_MESSAGE_BYTES: usize = 65_535;
const MAX_TRANSPORT_PAYLOAD_BYTES: usize = MAX_MESSAGE_BYTES - 16;

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
static SESSIONS: Lazy<Mutex<HashMap<String, Session>>> = Lazy::new(|| Mutex::new(HashMap::new()));

enum Session {
    Handshake(HandshakeState),
    Transport(TransportState),
}

#[derive(Deserialize)]
#[serde(tag = "command", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum Command {
    GenerateKeyPair,
    Start {
        mode: Mode,
        private_key: String,
        desktop_public_key: String,
    },
    ReadHandshake {
        session_id: String,
        message: String,
    },
    WriteHandshake {
        session_id: String,
        payload: String,
    },
    Encrypt {
        session_id: String,
        plaintext: String,
    },
    Decrypt {
        session_id: String,
        message: String,
    },
    Dispose {
        session_id: String,
    },
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Mode {
    Pairing,
    Device,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyPair {
    private_key: String,
    public_key: String,
}

fn decode_32(value: &str) -> Result<Vec<u8>, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "Key encoding is invalid".to_string())?;
    if bytes.len() != 32 || URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err("Key encoding is invalid".to_string());
    }
    Ok(bytes)
}

fn decode_message(value: &str, maximum: usize) -> Result<Vec<u8>, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "Message encoding is invalid".to_string())?;
    if bytes.len() > maximum || URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err("Message encoding is invalid".to_string());
    }
    Ok(bytes)
}

fn session_id() -> String {
    format!("noise-{}", NEXT_SESSION.fetch_add(1, Ordering::Relaxed))
}

fn generate_key_pair() -> Result<Value, String> {
    let parameters: NoiseParams = PAIRING_PATTERN
        .parse()
        .map_err(|_| "Noise parameters are unavailable".to_string())?;
    let pair = Builder::new(parameters)
        .generate_keypair()
        .map_err(|_| "Noise key generation failed".to_string())?;
    let mut private = pair.private;
    let private_key = URL_SAFE_NO_PAD.encode(&private);
    private.zeroize();
    Ok(serde_json::to_value(KeyPair {
        private_key,
        public_key: URL_SAFE_NO_PAD.encode(pair.public),
    })
    .map_err(|_| "Noise response failed".to_string())?)
}

fn start(mode: Mode, private_key: &str, desktop_public_key: &str) -> Result<Value, String> {
    let mut private = decode_32(private_key)?;
    let public = decode_32(desktop_public_key)?;
    let pattern = match mode {
        Mode::Pairing => PAIRING_PATTERN,
        Mode::Device => DEVICE_PATTERN,
    };
    let parameters: NoiseParams = pattern
        .parse()
        .map_err(|_| "Noise parameters are unavailable".to_string())?;
    let built = Builder::new(parameters)
        .local_private_key(&private)
        .remote_public_key(&public)
        .build_initiator();
    private.zeroize();
    let mut handshake = built.map_err(|_| "Noise session could not start".to_string())?;
    let mut output = vec![0; MAX_MESSAGE_BYTES];
    let length = handshake
        .write_message(&[], &mut output)
        .map_err(|_| "Noise handshake failed".to_string())?;
    let id = session_id();
    let mut sessions = SESSIONS
        .lock()
        .map_err(|_| "Noise session lock failed".to_string())?;
    if sessions.len() >= 32 {
        return Err("Noise session limit reached".to_string());
    }
    sessions.insert(id.clone(), Session::Handshake(handshake));
    Ok(json!({ "sessionId": id, "message": URL_SAFE_NO_PAD.encode(&output[..length]) }))
}

fn read_handshake(session_id: &str, message: &str) -> Result<Value, String> {
    let message = decode_message(message, MAX_MESSAGE_BYTES)?;
    let mut sessions = SESSIONS
        .lock()
        .map_err(|_| "Noise session lock failed".to_string())?;
    let removed = sessions
        .remove(session_id)
        .ok_or_else(|| "Noise session is unavailable".to_string())?;
    let Session::Handshake(mut handshake) = removed else {
        return Err("Noise handshake is already complete".to_string());
    };
    let mut output = vec![0; MAX_MESSAGE_BYTES];
    let length = handshake
        .read_message(&message, &mut output)
        .map_err(|_| "Noise handshake failed".to_string())?;
    let complete = handshake.is_handshake_finished();
    let payload = URL_SAFE_NO_PAD.encode(&output[..length]);
    if complete {
        sessions.insert(
            session_id.to_string(),
            Session::Transport(
                handshake
                    .into_transport_mode()
                    .map_err(|_| "Noise transport failed".to_string())?,
            ),
        );
    } else {
        sessions.insert(session_id.to_string(), Session::Handshake(handshake));
    }
    Ok(json!({ "payload": payload, "complete": complete }))
}

fn write_handshake(session_id: &str, payload: &str) -> Result<Value, String> {
    let payload = decode_message(payload, MAX_TRANSPORT_PAYLOAD_BYTES)?;
    let mut sessions = SESSIONS
        .lock()
        .map_err(|_| "Noise session lock failed".to_string())?;
    let removed = sessions
        .remove(session_id)
        .ok_or_else(|| "Noise session is unavailable".to_string())?;
    let Session::Handshake(mut handshake) = removed else {
        return Err("Noise handshake is already complete".to_string());
    };
    let mut output = vec![0; MAX_MESSAGE_BYTES];
    let length = handshake
        .write_message(&payload, &mut output)
        .map_err(|_| "Noise handshake failed".to_string())?;
    if !handshake.is_handshake_finished() {
        return Err("Noise handshake is incomplete".to_string());
    }
    sessions.insert(
        session_id.to_string(),
        Session::Transport(
            handshake
                .into_transport_mode()
                .map_err(|_| "Noise transport failed".to_string())?,
        ),
    );
    Ok(json!({ "message": URL_SAFE_NO_PAD.encode(&output[..length]) }))
}

fn transport(session_id: &str, value: &str, encrypting: bool) -> Result<Value, String> {
    let maximum = if encrypting {
        MAX_TRANSPORT_PAYLOAD_BYTES
    } else {
        MAX_MESSAGE_BYTES
    };
    let input = decode_message(value, maximum)?;
    let mut sessions = SESSIONS
        .lock()
        .map_err(|_| "Noise session lock failed".to_string())?;
    let removed = sessions
        .remove(session_id)
        .ok_or_else(|| "Noise session is unavailable".to_string())?;
    let Session::Transport(mut transport) = removed else {
        return Err("Noise handshake is incomplete".to_string());
    };
    let mut output = vec![0; MAX_MESSAGE_BYTES];
    let result = if encrypting {
        transport.write_message(&input, &mut output)
    } else {
        transport.read_message(&input, &mut output)
    };
    let length = result.map_err(|_| "Noise transport failed".to_string())?;
    sessions.insert(session_id.to_string(), Session::Transport(transport));
    Ok(if encrypting {
        json!({ "message": URL_SAFE_NO_PAD.encode(&output[..length]) })
    } else {
        json!({ "plaintext": URL_SAFE_NO_PAD.encode(&output[..length]) })
    })
}

fn execute(command: Command) -> Result<Value, String> {
    match command {
        Command::GenerateKeyPair => generate_key_pair(),
        Command::Start {
            mode,
            mut private_key,
            desktop_public_key,
        } => {
            let result = start(mode, &private_key, &desktop_public_key);
            private_key.zeroize();
            result
        }
        Command::ReadHandshake {
            session_id,
            message,
        } => read_handshake(&session_id, &message),
        Command::WriteHandshake {
            session_id,
            payload,
        } => write_handshake(&session_id, &payload),
        Command::Encrypt {
            session_id,
            plaintext,
        } => transport(&session_id, &plaintext, true),
        Command::Decrypt {
            session_id,
            message,
        } => transport(&session_id, &message, false),
        Command::Dispose { session_id } => {
            SESSIONS
                .lock()
                .map_err(|_| "Noise session lock failed".to_string())?
                .remove(&session_id);
            Ok(json!({ "disposed": true }))
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_kestrelbrain_noise_NoiseNative_execute<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    command: JString<'local>,
) -> jstring {
    let result = env
        .get_string(&command)
        .map(|value| value.into())
        .map_err(|_| "Noise command is invalid".to_string())
        .and_then(|value: String| {
            serde_json::from_str::<Command>(&value)
                .map_err(|_| "Noise command is invalid".to_string())
        })
        .and_then(execute)
        .and_then(|value| {
            serde_json::to_string(&value).map_err(|_| "Noise response failed".to_string())
        });
    match result {
        Ok(value) => env
            .new_string(value)
            .map(|output| output.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(error) => {
            let _ = env.throw_new("java/lang/IllegalStateException", error);
            std::ptr::null_mut()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VectorFile {
        vectors: Vec<Vector>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Vector {
        pattern: String,
        initiator_static_private: String,
        responder_static_private: String,
        responder_static_public: String,
        initiator_ephemeral_private: String,
        responder_ephemeral_private: String,
        handshake_payloads: Vec<String>,
        handshake_messages: Vec<String>,
        initiator_transport_messages: Vec<TransportVector>,
        responder_transport_messages: Vec<TransportVector>,
    }

    #[derive(Deserialize)]
    struct TransportVector {
        plaintext: String,
        message: String,
    }

    fn bytes(value: &str) -> Vec<u8> {
        hex::decode(value).unwrap()
    }

    #[test]
    fn bridge_accepts_camel_case_commands_from_javascript() {
        let commands = [
            json!({ "command": "start", "mode": "pairing", "privateKey": "key", "desktopPublicKey": "key" }),
            json!({ "command": "readHandshake", "sessionId": "session", "message": "message" }),
            json!({ "command": "writeHandshake", "sessionId": "session", "payload": "payload" }),
            json!({ "command": "encrypt", "sessionId": "session", "plaintext": "plaintext" }),
            json!({ "command": "decrypt", "sessionId": "session", "message": "message" }),
            json!({ "command": "dispose", "sessionId": "session" }),
        ];
        for command in commands {
            serde_json::from_value::<Command>(command).unwrap();
        }
    }

    #[test]
    fn shared_vectors_match_snow() {
        let fixture: VectorFile =
            serde_json::from_str(include_str!("../../../../tests/fixtures/noise-v1.json")).unwrap();
        for vector in fixture.vectors {
            let parameters: NoiseParams = vector.pattern.parse().unwrap();
            let initiator_static = bytes(&vector.initiator_static_private);
            let responder_static = bytes(&vector.responder_static_private);
            let responder_public = bytes(&vector.responder_static_public);
            let initiator_ephemeral = bytes(&vector.initiator_ephemeral_private);
            let responder_ephemeral = bytes(&vector.responder_ephemeral_private);
            let mut initiator = Builder::new(parameters.clone())
                .local_private_key(&initiator_static)
                .remote_public_key(&responder_public)
                .fixed_ephemeral_key_for_testing_only(&initiator_ephemeral)
                .build_initiator()
                .unwrap();
            let mut responder = Builder::new(parameters)
                .local_private_key(&responder_static)
                .fixed_ephemeral_key_for_testing_only(&responder_ephemeral)
                .build_responder()
                .unwrap();
            let mut output = vec![0; MAX_MESSAGE_BYTES];
            for (index, expected) in vector.handshake_messages.iter().enumerate() {
                let payload = bytes(&vector.handshake_payloads[index]);
                let length = if index % 2 == 0 {
                    initiator.write_message(&payload, &mut output).unwrap()
                } else {
                    responder.write_message(&payload, &mut output).unwrap()
                };
                assert_eq!(hex::encode(&output[..length]), *expected);
                let mut received = vec![0; MAX_MESSAGE_BYTES];
                let read = if index % 2 == 0 {
                    responder
                        .read_message(&output[..length], &mut received)
                        .unwrap()
                } else {
                    initiator
                        .read_message(&output[..length], &mut received)
                        .unwrap()
                };
                assert_eq!(&received[..read], payload);
            }
            let mut initiator = initiator.into_transport_mode().unwrap();
            let mut responder = responder.into_transport_mode().unwrap();
            for expected in vector.initiator_transport_messages {
                let plaintext = bytes(&expected.plaintext);
                let length = initiator.write_message(&plaintext, &mut output).unwrap();
                assert_eq!(hex::encode(&output[..length]), expected.message);
                let mut received = vec![0; MAX_MESSAGE_BYTES];
                let read = responder
                    .read_message(&output[..length], &mut received)
                    .unwrap();
                assert_eq!(&received[..read], plaintext);
            }
            for expected in vector.responder_transport_messages {
                let plaintext = bytes(&expected.plaintext);
                let length = responder.write_message(&plaintext, &mut output).unwrap();
                assert_eq!(hex::encode(&output[..length]), expected.message);
                let mut received = vec![0; MAX_MESSAGE_BYTES];
                let read = initiator
                    .read_message(&output[..length], &mut received)
                    .unwrap();
                assert_eq!(&received[..read], plaintext);
            }
        }
    }

    #[test]
    fn malformed_handshake_destroys_the_session() {
        let private_key = URL_SAFE_NO_PAD.encode([0x22; 32]);
        let public_key = URL_SAFE_NO_PAD.encode(bytes(
            "7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13",
        ));
        let started = start(Mode::Pairing, &private_key, &public_key).unwrap();
        let id = started["sessionId"].as_str().unwrap();
        assert!(read_handshake(id, "AA").is_err());
        assert_eq!(
            read_handshake(id, "AA").unwrap_err(),
            "Noise session is unavailable"
        );
    }
}

import { markdownActions } from "../notes/markdownActions";
import { requestedPageIndex } from "../library/pagination";
import { palette, styles } from "../theme/styles";
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MarkdownFormat } from "../notes/markdown";
import type { LocalExtractionProgress } from "../sources/artifacts";
import type { CardMenuOption, NavigationTab } from "../types";
import { t, tf } from "../i18n";

export function ScreenHeading({
  eyebrow,
  title,
  summary,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly summary: string;
}) {
  return (
    <View style={styles.screenHeading}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.screenTitle}>{title}</Text>
      <Text style={styles.summary}>{summary}</Text>
    </View>
  );
}

export function CardMenu({
  label,
  options,
}: {
  readonly label: string;
  readonly options: readonly CardMenuOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityLabel={tf("common.options_for", { title: label })}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.cardMenuButton}
      >
        <Text style={styles.cardMenuButtonText}>⋯</Text>
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <View style={styles.cardMenuOverlay}>
          <Pressable
            accessibilityLabel={t("common.close_options")}
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={styles.cardMenuBackdrop}
          />
          <View accessibilityViewIsModal style={styles.cardMenuSheet}>
            <Text numberOfLines={1} style={styles.cardMenuTitle}>
              {label}
            </Text>
            {options.map((option) => (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="button"
                key={option.label}
                onPress={() => {
                  setOpen(false);
                  option.action();
                }}
                style={styles.cardMenuOption}
              >
                <Text
                  style={[
                    styles.cardMenuOptionText,
                    option.destructive && styles.cardMenuOptionDestructive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

export function LibraryPagination({
  page,
  totalPages,
  busy,
  goToPage,
  compact = false,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly busy: boolean;
  readonly goToPage: (page: number) => void;
  readonly compact?: boolean;
}) {
  const [draft, setDraft] = useState<{
    readonly page: number;
    readonly text: string;
    readonly invalid: boolean;
  } | null>(null);
  const editing = draft?.page === page ? draft : null;
  const pageText = editing?.text ?? String(page + 1);
  const invalid = editing?.invalid ?? false;
  const setPageText = (text: string) =>
    setDraft({ page, text, invalid: false });
  const submit = () => {
    const requestedPage = requestedPageIndex(pageText, totalPages);
    if (requestedPage === null) {
      setDraft({ page, text: pageText, invalid: true });
      return;
    }
    setDraft(null);
    goToPage(requestedPage);
  };
  return (
    <View style={[styles.paginationBlock, compact && styles.libraryNavigationPagination]}>
      <View style={styles.paginationPosition}>
        <Text style={styles.paginationPageLabel}>{t("common.page")}</Text>
        <TextInput
          accessibilityLabel={tf("common.current_page_of", {
            total: totalPages,
          })}
          editable={!busy}
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={(value) => setPageText(value.replace(/[^0-9]/gu, ""))}
          onSubmitEditing={submit}
          selectTextOnFocus
          selectionColor={palette.link}
          style={[
            styles.paginationInput,
            compact && styles.libraryNavigationInput,
            invalid && styles.paginationInputInvalid,
          ]}
          value={pageText}
        />
        <Text style={styles.paginationLabel}>
          {t("common.of_pages")} {totalPages}
        </Text>
        <Pressable
          accessibilityLabel={t("common.go")}
          accessibilityRole="button"
          disabled={busy}
          onPress={submit}
          style={styles.paginationGo}
        >
          <Text style={styles.paginationGoText}>{t("common.go")}</Text>
        </Pressable>
      </View>
      <View style={styles.mobilePagination}>
        <Pressable
          accessibilityLabel={t("common.previous")}
          accessibilityRole="button"
          disabled={busy || page === 0}
          onPress={() => goToPage(page - 1)}
          style={[
            styles.paginationButton,
            (busy || page === 0) && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.paginationButtonText}>
            {t("common.previous")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={t("common.next")}
          accessibilityRole="button"
          disabled={busy || page + 1 >= totalPages}
          onPress={() => goToPage(page + 1)}
          style={[
            styles.paginationButton,
            (busy || page + 1 >= totalPages) && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.paginationButtonText}>{t("common.next")}</Text>
        </Pressable>
      </View>
      {invalid && (
        <Text accessibilityRole="alert" style={styles.paginationError}>
          Enter a page from 1 to {totalPages}.
        </Text>
      )}
    </View>
  );
}

export function ExtractionProgressBar({
  progress,
}: {
  readonly progress: LocalExtractionProgress;
}) {
  return (
    <View style={styles.extractionProgress}>
      <View style={styles.extractionProgressTrack}>
        <View
          style={[
            styles.extractionProgressFill,
            { width: `${progress.percent}%` },
          ]}
        />
      </View>
      <Text style={styles.extractionProgressText}>
        {progress.stage} · {progress.percent}%
      </Text>
    </View>
  );
}

export function MarkdownToolbar({
  apply,
}: {
  readonly apply: (format: MarkdownFormat) => void;
}) {
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={styles.markdownToolbar}
      contentContainerStyle={styles.markdownToolbarContent}
    >
      {markdownActions.map((action) => (
        <Pressable
          accessibilityLabel={action.label}
          accessibilityRole="button"
          key={action.format}
          onPress={() => apply(action.format)}
          style={styles.markdownAction}
        >
          <Text style={styles.markdownActionText}>{action.mark}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function BottomNavigation({
  active,
  select,
}: {
  readonly active: NavigationTab;
  readonly select: (tab: NavigationTab) => void;
}) {
  const tabs: readonly { id: NavigationTab; label: string; symbol: string }[] =
    [
      { id: "library", label: t("common.notes"), symbol: "▤" },
      { id: "ask", label: t("common.ask"), symbol: "?" },
      { id: "add", label: t("common.add"), symbol: "+" },
      { id: "settings", label: t("common.settings"), symbol: "⚙" },
    ];
  return (
    <View accessibilityRole="tablist" style={styles.navigation}>
      {tabs.map((tab) => (
        <Pressable
          accessibilityLabel={tab.label}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === tab.id }}
          key={tab.id}
          onPress={() => select(tab.id)}
          style={[styles.navigationItem, active === tab.id && styles.navigationItemActive]}
        >
          <Text
            accessible={false}
            style={[
              styles.navigationSymbol,
              active === tab.id && styles.navigationTextActive,
            ]}
          >
            {tab.symbol}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              styles.navigationText,
              active === tab.id && styles.navigationTextActive,
            ]}
          >
            {tab.label}
          </Text>
          <View
            style={[
              styles.navigationIndicator,
              active === tab.id && styles.navigationIndicatorActive,
            ]}
          />
        </Pressable>
      ))}
    </View>
  );
}

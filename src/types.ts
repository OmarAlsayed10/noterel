export type ConnectionState = 'loading' | 'unpaired' | 'paired' | 'connected' | 'offline' | 'expired' | 'invalid'
export type NavigationTab = 'library' | 'ask' | 'add' | 'settings'

export interface SelectedAskMemory {
  readonly sourceId: string
  readonly title: string
  readonly text: string | null
}

export interface CardMenuOption {
  readonly label: string
  readonly action: () => void
  readonly destructive?: boolean
}

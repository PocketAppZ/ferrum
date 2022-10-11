export type FlattenedListMenuItem = { label: string; enabled: boolean; id?: string }
export type ShowTrackMenuArgs = {
  ids: string[]
  playlist?: { indexes: number[]; editable: boolean }
  lists: FlattenedListMenuItem[]
  queue: boolean
}
export type ShowTracklistMenuArgs = {
  id: string
  isFolder: boolean
  isRoot: boolean
}

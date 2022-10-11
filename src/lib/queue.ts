import type { TrackID } from './libraryTypes'
import { writable } from 'svelte/store'

export const queueVisible = writable(false)
export function toggleQueueVisibility() {
  queueVisible.update((v) => !v)
}

let ids = [] as TrackID[]
let currentIndex = -1
let userQueueLength = 0
export type Queue = {
  ids: TrackID[],
  currentIndex: number,
  userQueueLength: number,
}
export const queue = writable({ ids, currentIndex, userQueueLength } as Queue)
function updateStore() {
  queue.set({ ids, currentIndex, userQueueLength })
}

export const getCurrent = () => ids[currentIndex]
export const getPrevious = () => ids[currentIndex - 1]
export const getNext = () => ids[currentIndex + 1]

export function prependToUserQueue(trackIds: TrackID[]) {
  if (ids.length === 0) {
    setNewQueue(trackIds, -1)
  } else {
    ids.splice(currentIndex + 1, 0, ...trackIds)
    userQueueLength += trackIds.length
    updateStore()
  }
}
export function appendToUserQueue(trackIds: TrackID[]) {
  if (ids.length === 0) {
    setNewQueue(trackIds, -1)
  } else {
    ids.splice(currentIndex + userQueueLength + 1, 0, ...trackIds)
    userQueueLength += trackIds.length
    updateStore()
  }
}

export function next() {
  if (currentIndex < ids.length) currentIndex += 1
  if (userQueueLength > 0) userQueueLength -= 1
  updateStore()
}
export function prev() {
  if (currentIndex > 0) {
    currentIndex -= 1
    userQueueLength += 1
  }
  updateStore()
}

// TODO: Preserve userQueue when setting a new queue. Before we do that, we need the ability to see and clear the userQueue.
export function setNewQueue(newIds: TrackID[], newCurrentIndex: number) {
  ids = newIds
  currentIndex = newCurrentIndex
  userQueueLength = 0
  updateStore()
}

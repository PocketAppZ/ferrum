const { ipcRenderer, remote } = window.require('electron')
import queue from './queue'

export function showTrackMenu(id: string) {
  const menu = remote.Menu.buildFromTemplate([
    {
      label: 'Add to Queue',
      click: () => queue.appendToUserQueue([id]),
    },
  ])
  menu.popup()
}

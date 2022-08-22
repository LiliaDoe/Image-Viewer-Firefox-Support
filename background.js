;(function () {
  'use strict'

  const i18n = tag => chrome.i18n.getMessage(tag)
  let args = []

  function resetLocalStorage() {
    chrome.storage.sync.get('options', res => {
      if (res && Object.keys(res).length === 0 && Object.getPrototypeOf(res) === Object.prototype) {
        const defaultOptions = {
          fitMode: 'both',
          zoomRatio: 1.2,
          rotateDeg: 15,
          minWidth: 150,
          minHeight: 150,
          debouncePeriod: 1500,
          throttlePeriod: 80,
          hotkey: ['Shift + Q', 'Shift + W', 'Shift + E', 'Shift + R', 'Ctrl + Alt + Q', ''],
          customUrl: ['https://example.com/search?query={imgSrc}&option=example_option']
        }
        chrome.storage.sync.set({options: defaultOptions}, () => {
          console.log('Set options to default values.')
        })
        chrome.runtime.openOptionsPage()
        return
      }
      console.log('Init comolete.')
      console.log(res)
    })
  }

  function addMessageHandler() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch (request.msg || request) {
        case 'get_options': {
          chrome.storage.sync.get('options', res => sendResponse(res))
          return true
        }
        case 'load_utility': {
          chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['scripts/utility.js']}, res => sendResponse({}))
          return true
        }
        case 'load_script': {
          chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['image-viewer.js']}, res => sendResponse({}))
          return true
        }
        case 'get_args': {
          sendResponse(args)
          args = []
          return true
        }
        case 'open_tab': {
          chrome.tabs.create({active: false, index: sender.tab.index + 1, url: request.url}, res => sendResponse({}))
          return true
        }
      }
    })
  }

  function createContextMenu() {
    chrome.contextMenus.removeAll()
    chrome.contextMenus.create({
      id: 'open_in_image_viewer',
      title: i18n('open_in_image_viewer'),
      contexts: ['image']
    })
    chrome.contextMenus.create({
      id: 'open_image_viewer',
      title: i18n('view_images_in_image_viewer'),
      contexts: ['page']
    })
    chrome.contextMenus.create({
      id: 'open_all_image_in_image_viewer',
      title: i18n('view_all_images_in_image_viewer'),
      contexts: ['action']
    })

    chrome.contextMenus.onClicked.addListener((info, tab) => {
      switch (info.menuItemId) {
        case 'open_in_image_viewer': {
          args.push(info.srcUrl)
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-image.js']})
          return
        }
        case 'open_image_viewer': {
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
          return
        }
        case 'open_all_image_in_image_viewer': {
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-all.js']})
          return
        }
      }
    })
  }

  function addTooltipdHandler() {
    chrome.action.onClicked.addListener(tab => {
      chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
    })
  }

  function addCommandHandler() {
    chrome.commands.onCommand.addListener((command, tab) => {
      switch (command) {
        case 'open-image-viewer': {
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
          return
        }
        case 'open-image-viewer-without-size-filter': {
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-all.js']})
          return
        }
      }
    })
  }

  function init() {
    resetLocalStorage()
    addMessageHandler()
    createContextMenu()
    addTooltipdHandler()
    addCommandHandler()
  }

  init()
})()

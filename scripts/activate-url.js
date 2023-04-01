;(async function () {
  'use strict'

  const image = document.querySelector(`body img[src='${location.href}']`)
  if (image) {
    const options = await chrome.runtime.sendMessage('get_options')
    options.closeButton = false
    options.minWidth = 0
    options.minHeight = 0

    await chrome.runtime.sendMessage('load_script')
    image.style.display = 'none'
    imageViewer([image.src], options)
    return
  }

  const init = () => {
    // chrome.scripting.executeScript never return on invalid iframe
    const safeHref = 'about:blank'
    const iframeList = document.querySelectorAll('iframe')
    for (const iframe of iframeList) {
      iframe.src = iframe.src.startsWith('javascript') ? safeHref : iframe.src
      iframe.classList.add('loadedWorker')
      iframe.classList.add('safeHref')
    }

    console.log('Init content script.')
    chrome.runtime.sendMessage('load_worker')

    const observer = new MutationObserver(() => {
      const newIframeList = document.querySelectorAll('iframe:not(.loadedWorker)')
      if (newIframeList.length === 0) return

      const iframeList = document.querySelectorAll('iframe:not(.safeHref)')
      for (const iframe of iframeList) {
        iframe.src = iframe.src.startsWith('javascript') ? safeHref : iframe.src
        iframe.classList.add('safeHref')
      }

      console.log('New iframe')
      chrome.runtime.sendMessage('load_worker')
      for (const iframe of newIframeList) {
        iframe.classList.add('loadedWorker')
      }
    })

    observer.observe(document, {childList: true, subtree: true})
    // for some rare case
    setTimeout(() => chrome.runtime.sendMessage('load_worker'), 3000)
  }

  if (document.visibilityState === 'visible') {
    init()
  } else {
    console.log('Waiting user to view the page.')
    const handleEvent = () => {
      document.removeEventListener('visibilitychange', handleEvent)
      window.removeEventListener('focus', handleEvent)
      init()
    }
    document.addEventListener('visibilitychange', handleEvent)
    window.addEventListener('focus', handleEvent)
  }
})()

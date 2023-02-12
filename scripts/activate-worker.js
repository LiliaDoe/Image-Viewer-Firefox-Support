;(function () {
  'use strict'

  function disablePtEvents() {
    for (const dom of document.querySelectorAll('*')) {
      if (dom.style.pointerEvents === 'none') {
        dom.style.pointerEvents = 'auto'
        dom.classList.add('noneToAuto')
      }
      const style = window.getComputedStyle(dom)
      if (style.pointerEvents === 'none') {
        dom.style.pointerEvents = 'auto'
        dom.classList.add('nullToAuto')
      }
    }
  }
  function restorePtEvents() {
    for (const dom of document.querySelectorAll('.noneToAuto')) {
      dom.style.pointerEvents = 'none'
      dom.classList.remove('noneToAuto')
    }
    for (const dom of document.querySelectorAll('.nullToAuto')) {
      dom.style.pointerEvents = ''
      dom.classList.remove('nullToAuto')
    }
  }
  function createDataUrl(srcUrl) {
    return new Promise(resolve => {
      const img = new Image()

      img.onload = () => {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        ctx.drawImage(img, 0, 0)
        const url = img.src.match('png') ? c.toDataURL() : img.src.match('webp') ? c.toDataURL('image/webp') : c.toDataURL('image/jpeg')
        resolve(url)
      }
      img.onerror = () => {
        console.log(new URL(srcUrl).hostname + ' block your access outside iframe')
        resolve('')
      }

      img.crossOrigin = 'anonymous'
      img.src = srcUrl
    })
  }

  const domSearcher = (function () {
    function extractImageInfoFromNode(dom) {
      if (dom.tagName === 'IMG') {
        const minSize = Math.min(dom.naturalWidth, dom.naturalHeight, dom.clientWidth, dom.clientHeight)
        markingDom(dom)
        return [dom.currentSrc, minSize, dom]
      }

      const minSize = Math.min(dom.clientWidth, dom.clientHeight)
      if (dom.tagName === 'VIDEO' && dom.hasAttribute('poster')) {
        markingDom(dom)
        return [dom.poster, minSize, dom]
      }

      const bg = window.getComputedStyle(dom).backgroundImage
      if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        const bgUrl = bg.substring(4, bg.length - 1).replace(/['"]/g, '')
        markingDom(dom)
        return [bgUrl, minSize, dom]
      }

      return null
    }
    function isImageInfoValid(imageInfo) {
      return imageInfo !== null && imageInfo[0] !== '' && imageInfo[0] !== 'about:blank'
    }
    const markingDom =
      window.top === window.self
        ? dom => {
            document.querySelector('.ImageViewerLastDom')?.classList.remove('ImageViewerLastDom')
            dom?.classList.add('ImageViewerLastDom')
          }
        : () => chrome.runtime.sendMessage('reset_dom')

    function checkZIndex(e1, e2) {
      const e1zIndex = parseInt(window.getComputedStyle(e1).zIndex)
      const e2zIndex = parseInt(window.getComputedStyle(e2).zIndex)

      if (e1zIndex === NaN || e2zIndex === NaN) return 0
      if (e1zIndex > e2zIndex) {
        return -1
      } else if (e1zIndex < e2zIndex) {
        return 1
      }
    }
    function checkPosition(e1, e2) {
      const e1Rect = e1.getBoundingClientRect()
      const e2Rect = e2.getBoundingClientRect()

      const commonParent = e1.offsetParent || e1.parentNode
      const parentPosition = commonParent.getBoundingClientRect()
      const e1ActualPosition = {
        x: e1Rect.x - parentPosition.x,
        y: e1Rect.y - parentPosition.y
      }
      const e2ActualPosition = {
        x: e2Rect.x - parentPosition.x,
        y: e2Rect.y - parentPosition.y
      }

      if (e1ActualPosition.y < e2ActualPosition.y) {
        return -1
      } else if (e1ActualPosition.y > e2ActualPosition.y) {
        return 1
      } else if (e1ActualPosition.x < e2ActualPosition.x) {
        return -1
      } else {
        return 1
      }
    }
    function getNodeTreeIndex(node) {
      let index = 0
      let currNode = node.previousSibling
      while (currNode) {
        if (currNode.nodeType !== 3 || !/^\s*$/.test(currNode.data)) {
          index++
        }
        currNode = node.previousSibling
      }
      return index
    }
    function checkTreeIndex(e1, e2) {
      const e1Order = getNodeTreeIndex(e1)
      const e2Order = getNodeTreeIndex(e2)
      if (e1Order > e2Order) {
        return -1
      } else {
        return 1
      }
    }
    function getTopElement(e1, e2) {
      //e1 -1, e2 1, same 0
      if (e1 === e2) return 0

      let result = checkZIndex(e1, e2)
      if (result !== 0) return result

      const e1Position = window.getComputedStyle(e1).position
      const e2Position = window.getComputedStyle(e2).position
      if (e1Position === 'absolute' || e2Position === 'absolute') {
        result = checkPosition(e1, e2)
      } else {
        result = checkTreeIndex(e1, e2)
      }
      return result
    }

    function getAllChildElements(node) {
      if (!node) return []

      const result = Array.from(node.children)
      if (node.shadowRoot) {
        result.push(...node.shadowRoot.children)
      }

      const childElements = Array.from(result)
      for (const child of childElements) {
        if (child.children || child.shadowRoot) {
          result.push(...getAllChildElements(child))
        }
      }
      return result
    }

    function searchImageFromTree(root, viewportPos) {
      const [mouseX, mouseY] = [viewportPos[0], viewportPos[1]]
      const relatedDomList = []
      for (const dom of getAllChildElements(root)) {
        const rect = dom.getBoundingClientRect()
        const inside = rect.left <= mouseX && rect.right >= mouseX && rect.top <= mouseY && rect.bottom >= mouseY
        if (inside) relatedDomList.push(dom)
      }

      const imageInfoList = []
      for (const dom of relatedDomList) {
        const imageInfo = extractImageInfoFromNode(dom)
        if (isImageInfoValid(imageInfo)) {
          imageInfoList.push(imageInfo)
        }
      }
      if (imageInfoList.length === 0) return null

      imageInfoList.sort((a, b) => getTopElement(a[2], b[2]))
      return imageInfoList[0]
    }

    return {
      searchDomByPosition: function (viewportPos) {
        const domList = []
        const ptEvent = []
        const infoList = []

        const dom = document.elementFromPoint(viewportPos[0], viewportPos[1])

        const imageInfo = extractImageInfoFromNode(dom)
        if (isImageInfoValid(imageInfo)) {
          infoList.push(imageInfo)
        }

        domList.push(dom)
        ptEvent.push(dom.style.pointerEvents)
        dom.style.pointerEvents = 'none'
        while (true) {
          const dom = document.elementFromPoint(viewportPos[0], viewportPos[1])
          if (dom === document.documentElement || dom === domList[domList.length - 1]) break

          const imageInfo = extractImageInfoFromNode(dom)
          if (isImageInfoValid(imageInfo)) {
            infoList.push(imageInfo)
          }

          domList.push(dom)
          ptEvent.push(dom.style.pointerEvents)
          dom.style.pointerEvents = 'none'
        }

        while (domList.length) {
          const lastDom = domList.pop()
          lastDom.style.pointerEvents = ptEvent.pop()
        }

        if (infoList.length) {
          let index = 0
          let maxSize = 0
          for (let i = 0; i < infoList.length; i++) {
            index = infoList[i][1] > maxSize ? i : index
          }
          markingDom(infoList[index][2])
          return infoList[index]
        }

        const imageInfoFromTree = searchImageFromTree(dom, viewportPos)
        if (isImageInfoValid(imageInfoFromTree)) {
          markingDom(imageInfoFromTree[2])
          return imageInfoFromTree
        }

        markingDom()
        return null
      }
    }
  })()

  document.addEventListener(
    'contextmenu',
    async e => {
      const viewportPosition = [e.clientX, e.clientY]
      disablePtEvents()
      const imageNodeInfo = domSearcher.searchDomByPosition(viewportPosition)
      restorePtEvents()
      if (!imageNodeInfo) return

      console.log(imageNodeInfo.pop())
      if (window.top !== window.self) {
        imageNodeInfo[0] = await createDataUrl(imageNodeInfo[0])
      }
      // dataURL may image maybe smaller
      imageNodeInfo[1] -= 10
      chrome.runtime.sendMessage({msg: 'update_info', data: imageNodeInfo})
    },
    true
  )
})()
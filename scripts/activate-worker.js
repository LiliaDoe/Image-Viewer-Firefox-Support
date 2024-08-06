;(async function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  if (document.documentElement.classList.contains('has-image-viewer-worker')) return

  document.documentElement.classList.add('has-image-viewer-worker')

  // init
  const options = window.ImageViewerOption
  const domainList = []
  const regexList = []
  for (const str of options.hoverCheckDisableList) {
    if (str[0] === '/' && str[str.length - 1] === '/') {
      regexList.push(str)
    } else {
      domainList.push(str)
    }
  }
  let disableHoverCheck = domainList.includes(location.hostname)
  disableHoverCheck ||= regexList.some(regex => regex.test(location.href))

  if (window.top === window.self && !disableHoverCheck) {
    const styles = 'html.iv-worker-idle img {pointer-events: auto !important;} .disable-hover {pointer-events: none !important;}'
    const styleSheet = document.createElement('style')
    styleSheet.textContent = styles
    document.head.appendChild(styleSheet)
    document.documentElement.classList.add('iv-worker-idle')
  }

  // image size
  const srcBitSizeMap = new Map()
  const srcRealSizeMap = new Map()
  const corsHostSet = new Set()
  const argsRegex = /(.*?[=.](?:jpeg|jpg|png|gif|webp|bmp|tiff|avif))(?!\/)/i

  async function fetchBitSize(url) {
    if (corsHostSet.has(url.hostname)) return 0
    try {
      const res = await fetch(url.href, {method: 'HEAD', signal: AbortSignal.timeout(5000)})
      if (!res.ok) return 0
      if (res.redirected) return -1
      const type = res.headers.get('Content-Type')
      const length = res.headers.get('Content-Length')
      if (type?.startsWith('image') || (type === 'application/octet-stream' && url.href.match(argsRegex))) {
        const size = Number(length)
        return size
      }
      return 0
    } catch (error) {
      if (error.name !== 'TimeoutError') corsHostSet.add(url.hostname)
      return 0
    }
  }
  function getImageBitSize(src) {
    if (!src || src === 'about:blank' || src.startsWith('data')) return 0

    const cache = srcBitSizeMap.get(src)
    if (cache !== undefined) return cache

    const promise = new Promise(_resolve => {
      const resolve = size => {
        srcBitSizeMap.set(src, size)
        _resolve(size)
      }

      let waiting = false
      const updateSize = size => {
        if (size) resolve(size)
        else if (waiting) waiting = false
        else if (src.startsWith('blob')) return resolve(Number.MAX_SAFE_INTEGER)
        else resolve(0)
      }

      // protocol-relative URL
      const url = new URL(src, document.baseURI)
      const href = url.href
      if (url.hostname !== location.hostname) {
        waiting = true
        safeSendMessage({msg: 'get_size', url: href}).then(updateSize)
      }
      fetchBitSize(url).then(updateSize)
    })

    srcBitSizeMap.set(src, promise)
    return promise
  }
  async function getImageRealSize(src) {
    const cache = srcRealSizeMap.get(src)
    if (cache !== undefined) return cache

    const promise = new Promise(_resolve => {
      const resolve = size => {
        srcRealSizeMap.set(src, size)
        _resolve(size)
      }

      const img = new Image()
      img.onload = () => resolve(Math.min(img.naturalWidth, img.naturalHeight))
      img.onerror = () => resolve(0)
      setTimeout(() => resolve(0), 10000)
      img.src = src
    })

    srcRealSizeMap.set(src, promise)
    return promise
  }

  // image info
  const domSearcher = (function () {
    // searchImageFromTree
    function checkZIndex(e1, e2) {
      const e1zIndex = Number(window.getComputedStyle(e1).zIndex)
      const e2zIndex = Number(window.getComputedStyle(e2).zIndex)

      if (Number.isNaN(e1zIndex) || Number.isNaN(e2zIndex)) return 0
      if (e1zIndex > e2zIndex) {
        return -1
      } else if (e1zIndex < e2zIndex) {
        return 1
      } else {
        return 0
      }
    }
    function checkPosition(e1, e2) {
      const e1Rect = e1.getBoundingClientRect()
      const e2Rect = e2.getBoundingClientRect()

      const commonParent = e1.offsetParent || e1.parentNode
      const parentPosition = commonParent.getBoundingClientRect()

      const e1ActualPositionX = e1Rect.x - parentPosition.x
      const e1ActualPositionY = e1Rect.y - parentPosition.y
      const e2ActualPositionX = e2Rect.x - parentPosition.x
      const e2ActualPositionY = e2Rect.y - parentPosition.y

      if (e1ActualPositionY < e2ActualPositionY) {
        return -1
      } else if (e1ActualPositionY > e2ActualPositionY) {
        return 1
      } else if (e1ActualPositionX < e2ActualPositionX) {
        return -1
      } else {
        return 1
      }
    }
    function getTopElement(e1, e2) {
      // e1 -1, e2 1, same 0
      if (e1 === e2) return 0

      let result = checkZIndex(e1, e2)
      if (result !== 0) return result

      const e1Position = window.getComputedStyle(e1).position
      const e2Position = window.getComputedStyle(e2).position
      if (e1Position === 'absolute' || e2Position === 'absolute') {
        result = checkPosition(e1, e2)
      } else {
        result = e1.compareDocumentPosition(e2) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      }
      return result
    }

    function getAllChildElements(node) {
      const result = []
      const stack = [node]
      while (stack.length) {
        const current = stack.pop()
        for (const node of current.querySelectorAll('*')) {
          result.push(node)
          if (node.shadowRoot) {
            stack.push(node.shadowRoot)
          }
        }
      }
      return result
    }

    async function searchImageFromTree(dom, viewportPos) {
      if (!dom) return null

      let root = dom
      let prevSibling = root.previousElementSibling
      let nextSibling = root.nextElementSibling

      let rootClassList = root.classList.toString()
      let prevClassList = prevSibling && prevSibling.classList.toString()
      let nextClassList = nextSibling && nextSibling.classList.toString()

      let hasSameKindSibling = false
      hasSameKindSibling ||= prevSibling ? prevClassList === rootClassList || prevSibling.tagName === root.tagName : false
      hasSameKindSibling ||= nextSibling ? nextClassList === rootClassList || nextSibling.tagName === root.tagName : false
      while (!hasSameKindSibling && root.parentElement) {
        root = root.parentElement
        prevSibling = root.previousElementSibling
        nextSibling = root.nextElementSibling

        rootClassList = root.classList.toString()
        prevClassList = prevSibling && prevSibling.classList.toString()
        nextClassList = nextSibling && nextSibling.classList.toString()

        hasSameKindSibling ||= prevSibling ? prevClassList === rootClassList || prevSibling.tagName === root.tagName : false
        hasSameKindSibling ||= nextSibling ? nextClassList === rootClassList || nextSibling.tagName === root.tagName : false
      }

      const [mouseX, mouseY] = viewportPos
      const relatedDomList = []
      const childList = getAllChildElements(root)
      for (const dom of childList) {
        const hidden = dom.offsetParent === null && dom.style.position !== 'fixed'
        if (hidden) {
          relatedDomList.push(dom)
          continue
        }
        const rect = dom.getBoundingClientRect()
        const inside = rect.left <= mouseX && rect.right >= mouseX && rect.top <= mouseY && rect.bottom >= mouseY
        if (inside) relatedDomList.push(dom)
      }

      const imageInfoList = []
      for (const dom of relatedDomList) {
        const imageInfo = await extractImageInfo(dom)
        if (isImageInfoValid(imageInfo)) imageInfoList.push(imageInfo)
      }
      if (imageInfoList.length === 0) {
        return childList.length < 5 ? searchImageFromTree(root.parentElement, viewportPos) : null
      }
      if (imageInfoList.length === 1) return imageInfoList[0]
      const filteredImageInfoList = imageInfoList.filter(info => info[2].tagName === 'IMG')
      if (filteredImageInfoList.length === 1) return filteredImageInfoList[0]

      imageInfoList.sort((a, b) => {
        if (a[2].tagName === 'IMG' && b[2].tagName === 'IMG') return a[2].compareDocumentPosition(b[2]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        if (a[2].tagName !== 'IMG' && b[2].tagName !== 'IMG') return getTopElement(a[2], b[2])
        if (a[2].tagName === 'IMG') return -1
        if (b[2].tagName === 'IMG') return 1
        return 0
      })
      const first = imageInfoList[0]
      const second = imageInfoList[1]
      const check = await isNewImageInfoBetter(first, second)
      return check ? first : second
    }

    // utility
    async function extractBackgroundInfo(dom, minSize) {
      const nodeStyle = window.getComputedStyle(dom)
      const backgroundImage = nodeStyle.backgroundImage
      if (backgroundImage === 'none') return null
      const bgList = backgroundImage.split(', ').filter(bg => bg.startsWith('url') && !bg.endsWith('.svg")'))
      if (bgList.length === 0) return null

      const bgUrl = bgList[0].slice(5, -2)
      const realMinSize = Math.min(minSize, await getImageRealSize(bgUrl))
      return [bgUrl, realMinSize, dom]
    }
    async function extractImageInfo(dom) {
      const {width, height} = dom.getBoundingClientRect()
      if (dom.tagName === 'IMG') {
        // real time size and rendered size
        const sizeList = [width, height, dom.clientWidth, dom.clientHeight, dom.naturalWidth, dom.naturalHeight]
        const minSize = Math.min(...sizeList.filter(Boolean))
        return [dom.currentSrc, minSize, dom]
      }
      const minSize = Math.min(width, height, dom.clientWidth, dom.clientHeight)
      if (dom.tagName === 'VIDEO' && dom.hasAttribute('poster')) {
        return [dom.poster, minSize, dom]
      }
      const bgInfo = extractBackgroundInfo(dom, minSize)
      return bgInfo
    }
    async function extractImageInfoFromTree(dom) {
      const domInfo = await extractImageInfo(dom)
      if (domInfo) return domInfo

      const allChildren = getAllChildElements(dom)
      if (allChildren.length < 5) {
        for (const children of allChildren) {
          const info = await extractImageInfo(children)
          if (info) return info
        }
      }
      return null
    }

    const isImageInfoValid = imageInfo => imageInfo !== null && imageInfo[0] !== '' && imageInfo[0] !== 'about:blank'
    const isNewImageInfoBetter = async (newInfo, oldInfo) => {
      if (oldInfo === null) return true
      // data url
      const newUrl = newInfo[0]
      const oldUrl = oldInfo[0]
      if (newUrl.startsWith('data')) return false
      if (oldUrl.startsWith('data')) return true
      // svg image
      const newIsSvg = newUrl.startsWith('data:image/svg') || newUrl.includes('.svg')
      const oldIsSvg = oldUrl.startsWith('data:image/svg') || oldUrl.includes('.svg')
      if (oldIsSvg && !newIsSvg) return true
      // element type
      const oldIsImage = oldInfo[2].tagName === 'IMG' || oldInfo[2].tagName === 'VIDEO'
      const newIsImage = newInfo[2].tagName === 'IMG' || newInfo[2].tagName === 'VIDEO'
      // placeholder
      const oldIsPlaceholder = oldInfo[1] < 10
      if (oldIsImage && !newIsImage && !oldIsPlaceholder) return false
      // partial background
      if (!oldIsImage && newIsImage && !oldIsPlaceholder) {
        const bgPos = window.getComputedStyle(oldInfo[2]).backgroundPosition
        const isPartialBackground = bgPos.split('px').map(Number).some(Boolean)
        return isPartialBackground ? newInfo[1] >= oldInfo[1] : true
      }
      // size check
      const asyncList = [[newUrl, oldUrl].map(getImageBitSize), [newUrl, oldUrl].map(getImageRealSize)].flat()
      const [newBitSize, oldBitSize, newRealSize, oldRealSize] = await Promise.all(asyncList)
      if (newBitSize * oldBitSize !== 0) {
        return newBitSize / newRealSize > oldBitSize / oldRealSize
      }
      return newRealSize > oldRealSize
    }
    const markingDom = (function () {
      return window.top === window.self
        ? dom => {
            window.ImageViewerLastDom = dom
          }
        : () => safeSendMessage('reset_dom')
    })()

    return {
      searchDomByPosition: async function (elementList, viewportPos) {
        let firstVisibleDom = null
        let imageInfoFromPoint = null
        let imageDomLayer = 0

        let hiddenImageInfoFromPoint = null
        let hiddenDomLayer = 0

        const maxTry = Math.min(20, elementList.length)
        let index = 0
        let tryCount = 0
        while (tryCount < maxTry) {
          const dom = elementList[index]
          const visible = dom.offsetParent !== null || dom.style.position === 'fixed'
          firstVisibleDom ??= visible ? dom : null
          const imageInfo = await (!imageInfoFromPoint ? extractImageInfoFromTree(dom) : extractImageInfo(dom))
          const valid = isImageInfoValid(imageInfo)
          if (!valid) {
            index++
            tryCount++
            continue
          }
          if (!visible) {
            hiddenImageInfoFromPoint = imageInfo
            hiddenDomLayer = index++
            tryCount = Math.max(maxTry - 5, ++tryCount)
            continue
          }
          const better = await isNewImageInfoBetter(imageInfo, imageInfoFromPoint)
          if (better) {
            imageInfoFromPoint = imageInfo
            imageDomLayer = index
            const url = imageInfoFromPoint[0]
            const svgImg = url.startsWith('data:image/svg') || url.includes('.svg')
            if (!svgImg) tryCount = Math.max(maxTry - 5, tryCount)
          }
          index++
          tryCount++
        }

        if (imageInfoFromPoint) {
          console.log(`Image node found, layer ${imageDomLayer}`)
          markingDom(imageInfoFromPoint[2])
          return imageInfoFromPoint
        }

        if (hiddenImageInfoFromPoint) {
          console.log(`Hidden image node found, layer ${hiddenDomLayer}`)
          markingDom(hiddenImageInfoFromPoint[2])
          return hiddenImageInfoFromPoint
        }

        const imageInfoFromTree = await searchImageFromTree(firstVisibleDom, viewportPos)
        if (isImageInfoValid(imageInfoFromTree)) {
          console.log('Image node found, hide under dom tree')
          markingDom(imageInfoFromTree[2])
          return imageInfoFromTree
        }

        markingDom(null)
        return null
      }
    }
  })()

  function deepGetElementFromPoint(x, y) {
    const queue = []
    const visited = new Set()
    const elementList = document.elementsFromPoint(x, y)

    function travel(root) {
      // lazy evaluation
      return () => {
        const result = []
        const elementList = root.elementsFromPoint(x, y)
        for (const element of elementList) {
          if (visited.has(element) || visited.has(element.shadowRoot)) continue
          if (element.shadowRoot) {
            visited.add(element.shadowRoot)
            result.push(travel(element.shadowRoot))
          } else {
            visited.add(element)
            result.push(element)
          }
        }
        return result
      }
    }

    for (const element of elementList) {
      if (element.shadowRoot) {
        visited.add(element.shadowRoot)
        queue.push(travel(element.shadowRoot))
      } else {
        visited.add(element)
        queue.push(element)
      }
    }

    function evaluate(queue) {
      if (queue.some(i => typeof i === 'function')) {
        queue = queue.map(i => (typeof i === 'function' ? i() : i)).flat()
        return evaluate(queue)
      }
      return queue
    }
    const result = evaluate(queue)
    return result
  }

  const getOrderedElement = (function () {
    return disableHoverCheck
      ? e => deepGetElementFromPoint(e.clientX, e.clientY)
      : async e => {
          // get all elements include hover
          const elementsBeforeDisableHover = deepGetElementFromPoint(e.clientX, e.clientY)
          // reset pointer event as default
          document.documentElement.classList.remove('iv-worker-idle')
          // disable hover
          const mouseLeaveEvent = new Event('mouseleave')
          for (const element of elementsBeforeDisableHover) {
            element.classList.add('disable-hover')
            element.dispatchEvent(mouseLeaveEvent)
          }
          // release priority and allow other script clear up hover element
          await new Promise(resolve => setTimeout(resolve, 10))
          // clean up css
          for (const element of elementsBeforeDisableHover) {
            element.classList.remove('disable-hover')
          }
          // get all non hover elements
          const elementsAfterDisableHover = deepGetElementFromPoint(e.clientX, e.clientY)
          // lock pointer event back to auto
          document.documentElement.classList.add('iv-worker-idle')

          const stableElements = []
          const unstableElements = []
          for (const elem of elementsBeforeDisableHover) {
            if (elementsAfterDisableHover.includes(elem)) {
              stableElements.push(elem)
            } else {
              unstableElements.push(elem)
            }
          }
          const orderedElements = stableElements.concat(unstableElements)
          return orderedElements
        }
  })()

  document.addEventListener(
    'contextmenu',
    async e => {
      if (document.documentElement.classList.contains('has-image-viewer')) return
      // release priority and allow contextmenu work properly
      await new Promise(resolve => setTimeout(resolve, 0))
      const viewportPosition = [e.clientX, e.clientY]
      const orderedElements = await getOrderedElement(e)
      const imageNodeInfo = await domSearcher.searchDomByPosition(orderedElements, viewportPosition)
      if (!imageNodeInfo) return

      // display image dom
      console.log(imageNodeInfo.pop())

      // get data url if CORS
      if (window.top !== window.self) {
        imageNodeInfo[0] = await safeSendMessage({msg: 'get_local_url', url: imageNodeInfo[0]})
      }
      // image size maybe decreased in dataURL
      imageNodeInfo[1] -= 3
      safeSendMessage({msg: 'update_info', data: imageNodeInfo})
    },
    true
  )
})()

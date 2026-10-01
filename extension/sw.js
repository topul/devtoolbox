/**
 * DevOps Toolbox 扩展 —— 后台 Service Worker。
 *
 * 唯一职责：点击工具栏图标时开一个完整标签页。
 * 整页形态保留全部 UI（侧栏 / ⌘K / 分组），不做窄栏 popup 适配。
 */
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app/index.html') })
})

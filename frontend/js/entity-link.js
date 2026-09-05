// Flow & Accord · 统一实体跳转组件 (v1.28.3)
(function () {
  'use strict';
  function idOf(value) { const id = Number(value); return Number.isSafeInteger(id) && id >= 0 ? id : null; }
  function agent(id, label, options) {
    const safe = idOf(id); if (safe == null) return '';
    const o = options || {}; const keep = o.keepContext ? ' data-keep-context="1"' : '';
    return `<button type="button" class="entity-link entity-link-agent lineage-chip ${o.className || ''}" data-entity-kind="agent" data-entity-id="${safe}" title="${o.title || '点击追踪族人'}"${keep}>${label == null ? `👤 #${safe}` : label}</button>`;
  }
  function house(id, label, options) {
    const safe = idOf(id); if (safe == null) return '';
    const o = options || {};
    return `<button type="button" class="entity-link entity-link-house lineage-chip house ${o.className || ''}" data-entity-kind="house" data-entity-id="${safe}" title="${o.title || '查看房屋'}">${label == null ? `🏠 #${safe}` : label}</button>`;
  }
  window.EntityLink = { agent, house, parseId: idOf };
  document.addEventListener('click', function (event) {
    const link = event.target.closest('[data-entity-kind][data-entity-id], .lineage-chip[data-agent-id], .lineage-chip[data-house-id]'); if (!link) return;
    const kind = link.dataset.entityKind || (link.dataset.agentId != null ? 'agent' : 'house');
    const id = idOf(link.dataset.entityId || link.dataset.agentId || link.dataset.houseId); if (id == null) return;
    const routed = kind === 'agent'
      ? (typeof window.focusOnAgent === 'function' && window.focusOnAgent(id))
      : (typeof window.focusOnHouse === 'function' && window.focusOnHouse(id));
    if (!routed) return;
    if (!link.dataset.keepContext && kind === 'agent') {
      if (typeof window.closeAuctionModal === 'function' && window.isAuctionModalOpen && window.isAuctionModalOpen()) window.closeAuctionModal();
      if (typeof window.closeCampDetail === 'function' && window.isCampDetailOpen && window.isCampDetailOpen()) window.closeCampDetail();
    }
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
})();

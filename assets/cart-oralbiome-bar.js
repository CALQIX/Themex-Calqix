class CartOralBiomeBar extends HTMLElement {
  connectedCallback() {
    this.handles = (this.dataset.oralbiomeHandles || '')
      .split(',')
      .map((handle) => handle.trim())
      .filter(Boolean);
  }

  getOralBiomeQty(cart) {
    if (!cart || !Array.isArray(cart.items)) return 0;
    return cart.items
      .filter((item) => this.handles.includes(item.handle) || String(item.handle || '').indexOf('oralbiome-pro-') === 0)
      .reduce((sum, item) => sum + (item.quantity || 0), 0);
  }
}

if (!customElements.get('cart-oralbiome-bar')) {
  customElements.define('cart-oralbiome-bar', CartOralBiomeBar);
}

class CartOralBiomeBar extends HTMLElement {
  connectedCallback() {
    this.handles = (this.dataset.oralbiomeHandles || '')
      .split(',')
      .map((handle) => handle.trim())
      .filter(Boolean);
    this.animateQtyChange();
  }

  getOralBiomeQty(cart) {
    if (!cart || !Array.isArray(cart.items)) return 0;
    return cart.items
      .filter((item) => this.handles.includes(item.handle) || String(item.handle || '').indexOf('oralbiome-pro-') === 0)
      .reduce((sum, item) => sum + (item.quantity || 0), 0);
  }

  animateQtyChange() {
    const qty = Number(this.dataset.oralbiomeQty || 0);
    const previousQty = Number(sessionStorage.getItem('oralbiomeRewardQty') || 0);
    if (previousQty > 0 && qty > previousQty) {
      this.classList.add('is-incrementing');
    } else if (previousQty > qty) {
      this.classList.add('is-decrementing');
    }
    sessionStorage.setItem('oralbiomeRewardQty', String(qty));
  }
}

if (!customElements.get('cart-oralbiome-bar')) {
  customElements.define('cart-oralbiome-bar', CartOralBiomeBar);
}

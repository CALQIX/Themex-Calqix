class CartDiscount extends HTMLElement {
  connectedCallback() {
    this.toggle = this.querySelector('[data-cart-discount-toggle]');
    this.form = this.querySelector('[data-cart-discount-form]');
    this.input = this.querySelector('[data-cart-discount-input]');
    this.message = this.querySelector('[data-cart-discount-message]');
    this.title = this.querySelector('[data-cart-discount-title]');
    this.stateNode = this.querySelector('[data-cart-discount-state]');
    this.bindEvents();
    this.syncState();
    this.handleUrlDiscountIntent();
  }

  bindEvents() {
    if (this.toggle) {
      this.toggle.addEventListener('click', () => this.toggleExpanded());
    }
    if (this.form) {
      this.form.addEventListener('submit', (event) => this.onSubmit(event));
    }
    this.querySelectorAll('[data-cart-discount-remove]').forEach((button) => {
      button.addEventListener('click', () => this.removeDiscount(button.dataset.cartDiscountRemove));
    });
  }

  syncState() {
    const state = this.getState();
    this.classList.toggle('has-discounts', state.count > 0);
    if (this.title) {
      if (state.count === 1) {
        this.title.textContent = `1 ${this.dataset.activeSingular || 'discount active'}`;
      } else if (state.count > 1) {
        this.title.textContent = `${state.count} ${this.dataset.activePlural || 'discounts active'}`;
      } else {
        this.title.textContent = this.dataset.prompt || 'Have a discount code?';
      }
    }
  }

  getState() {
    try {
      return JSON.parse(this.stateNode?.textContent || '{}');
    } catch (error) {
      return { count: 0, manual: 0, automatic: 0 };
    }
  }

  toggleExpanded(force) {
    const isExpanded = typeof force === 'boolean' ? force : !this.classList.contains('is-expanded');
    this.classList.toggle('is-expanded', isExpanded);
    if (this.toggle) this.toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    if (isExpanded && this.input) {
      setTimeout(() => this.input.focus(), 180);
    }
  }

  async onSubmit(event) {
    event.preventDefault();
    const code = (this.input?.value || '').trim();
    if (!code) return;
    const existingCodes = this.getAppliedCodes();
    if (existingCodes.some((existing) => existing.toLowerCase() === code.toLowerCase())) {
      this.showError(this.dataset.alreadyApplied || 'Code already applied');
      return;
    }
    this.setLoading(true);
    this.clearError();
    try {
      const result = await this.applyDiscount(code);
      if (!result.success) {
        this.showError(result.error || this.dataset.invalid || 'Invalid or expired code');
        return;
      }
      this.toggleExpanded(false);
      await this.refreshDrawer();
    } catch (error) {
      this.showError(this.dataset.invalid || 'Invalid or expired code');
    } finally {
      this.setLoading(false);
    }
  }

  getAppliedCodes() {
    return Array.from(this.querySelectorAll('[data-discount-code]'))
      .map((tag) => tag.dataset.discountCode)
      .filter(Boolean);
  }

  async applyDiscount(code) {
    const existingCodes = this.getAppliedCodes();
    const nextCodes = [...existingCodes, code];
    const response = await fetch('/cart/update.js', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ discount: nextCodes.join(',') }),
    });
    const cart = await response.json();
    const applied = Array.isArray(cart.discount_codes) && cart.discount_codes.some((discount) => {
      return discount.code && discount.code.toLowerCase() === code.toLowerCase() && discount.applicable;
    });
    return applied ? { success: true, cart } : { success: false, error: this.dataset.invalid || 'Invalid or expired code', cart };
  }

  async removeDiscount(code) {
    if (!code) return;
    this.setLoading(true);
    this.clearError();
    try {
      const cart = await fetch('/cart.js', { headers: { Accept: 'application/json' } }).then((response) => response.json());
      const remainingCodes = (cart.discount_codes || [])
        .filter((discount) => discount.code !== code && discount.applicable)
        .map((discount) => discount.code);
      await fetch('/cart/update.js', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ discount: remainingCodes.join(',') }),
      });
      await this.refreshDrawer();
    } catch (error) {
      this.showError(this.dataset.invalid || 'Invalid or expired code');
    } finally {
      this.setLoading(false);
    }
  }

  async refreshDrawer() {
    document.dispatchEvent(new CustomEvent('cart-drawer:refresh', { bubbles: true, detail: { source: 'cart-discount' } }));
  }

  async handleUrlDiscountIntent() {
    if (CartDiscount.urlIntentHandled) return;
    const params = new URLSearchParams(window.location.search);
    const shouldOpenCart = params.get('cq_open_cart') === '1';
    const code = (params.get('cq_discount') || '').trim();

    if (!shouldOpenCart && !code) return;
    CartDiscount.urlIntentHandled = true;

    this.clearUrlDiscountIntent(params);
    this.setLoading(Boolean(code));
    this.clearError();

    try {
      if (code) {
        const result = await this.applyDiscount(code);
        if (!result.success) {
          this.showError(result.error || this.dataset.invalid || 'Invalid or expired code');
        }
      }
      await this.refreshDrawer();
    } catch (error) {
      if (code) this.showError(this.dataset.invalid || 'Invalid or expired code');
    } finally {
      this.setLoading(false);
      window.setTimeout(() => this.openCartDrawer(), 120);
    }
  }

  clearUrlDiscountIntent(params) {
    if (!window.history?.replaceState) return;
    const nextParams = new URLSearchParams(params);
    nextParams.delete('cq_open_cart');
    nextParams.delete('cq_discount');
    const query = nextParams.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
  }

  openCartDrawer() {
    const drawer = document.querySelector('cart-drawer');
    const isOpen = drawer?.hasAttribute('open') || document.body.classList.contains('page-overlay-cart-on');
    if (isOpen) return;
    if (drawer && typeof drawer.toggleDrawerClasses === 'function') {
      drawer.toggleDrawerClasses();
      return;
    }
    document.querySelector('.wt-cart__trigger')?.click();
  }

  setLoading(isLoading) {
    this.classList.toggle('is-loading', isLoading);
    const button = this.querySelector('[data-cart-discount-apply]');
    if (button) button.disabled = isLoading;
  }

  showError(message) {
    this.classList.add('has-error');
    if (this.message) this.message.textContent = message;
  }

  clearError() {
    this.classList.remove('has-error');
    if (this.message) this.message.textContent = '';
  }
}

if (!customElements.get('cart-discount')) {
  customElements.define('cart-discount', CartDiscount);
}

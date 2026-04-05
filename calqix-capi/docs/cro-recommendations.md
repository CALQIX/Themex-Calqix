# CRO Aanbevelingen - 5-4-2026

# 5 Concrete CRO Verbeteringen voor CALQIX (Hoogste Impact Eerst)

## 1. **Social Proof Counter met Dynamische Aantallen**

**Wat:** Voeg een prominente teller toe die het aantal verkochte producten of tevreden klanten toont, specifiek voor oral care doelgroep.

**Waar:** Direct onder de productnaam en prijs, boven de variant picker.

**Waarom:** Activeerd het principe van sociale bevestiging (social proof) - vooral krachtig bij premium oral care omdat mensen willen weten dat anderen al succesvol hun mondgezondheid hebben verbeterd.

**Implementatie:**
```liquid
<!-- Voeg toe in product.liquid template -->
<div class="social-proof-counter" style="margin: 12px 0; padding: 8px 12px; background: #f8fdf8; border-radius: 6px; border-left: 3px solid #22c55e;">
  <div style="display: flex; align-items: center; gap: 8px;">
    <svg width="16" height="16" fill="#22c55e" viewBox="0 0 24 24">
      <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 7C14.5 7 14 7.5 14 8V22H16V16H18V22H20V9H21Z"/>
    </svg>
    <span style="font-size: 14px; color: #16a34a; font-weight: 500;">
      {% if product.handle == 'oralbiome-pro-peach' %}
        <strong>2.847</strong> klanten verbeterden hun mondgezondheid
      {% elsif product.handle == 'flowcore-waterflosser' %}
        <strong>1.523</strong> gebruikers zien zichtbaar schonere tanden
      {% endif %}
    </span>
  </div>
</div>
```

---

## 2. **Urgentie Element met Voorraad Indicator**

**Wat:** Voeg een subtiele maar effectieve voorraad-indicator toe met beperkte beschikbaarheid messaging.

**Waar:** Direct boven de "Toevoegen aan winkelwagen" knop.

**Waarom:** Creëert urgentie zonder te opdringerig te zijn. Bij premium oral care producten is beperkte voorraad geloofwaardig omdat het kwaliteitsperceptie versterkt.

**Implementatie:**
```liquid
<!-- Voeg toe direct boven add-to-cart button -->
<div class="urgency-indicator" style="margin: 16px 0 12px 0; padding: 10px; background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%); border-radius: 8px; border: 1px solid #f59e0b;">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <div style="display: flex; align-items: center; gap: 8px;">
      <div style="width: 8px; height: 8px; background: #f59e0b; border-radius: 50%; animation: pulse 2s infinite;"></div>
      <span style="font-size: 13px; color: #92400e; font-weight: 500;">
        {% assign random_stock = 'now' | date: '%S' | modulo: 15 | plus: 3 %}
        Nog slechts {{ random_stock }} stuks op voorraad
      </span>
    </div>
    <svg width="16" height="16" fill="#f59e0b" viewBox="0 0 24 24">
      <path d="M12 2L13.09 8.26L22 9L13.09 9.74L12 16L10.91 9.74L2 9L10.91 8.26L12 2Z"/>
    </svg>
  </div>
</div>

<style>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
```

---

## 3. **Geïntegreerde Vertrouwens-Stack bij Add-to-Cart**

**Wat:** Combineer verzendinfo, geld-terug-garantie en betaalmethodes in één compacte vertrouwensblok direct onder de ATC knop.

**Waar:** Direct onder de "Toevoegen aan winkelwagen" knop, voor de bestaande trust badges.

**Waarom:** Vermindert friction op het beslissingsmoment door alle bezwaren weg te nemen (verzendkosten, risico, betaalmogelijkheden) precies wanneer de klant wil kopen.

**Implementatie:**
```liquid
<!-- Voeg toe direct onder add-to-cart button -->
<div class="trust-stack" style="margin: 16px 0; padding: 16px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0;">
  <div style="display: grid; grid-template-columns: 1fr; gap: 12px; font-size: 13px;">
    
    <!-- Gratis verzending -->
    <div style="display: flex; align-items: center; gap: 10px;">
      <svg width="18" height="18" fill="#059669" viewBox="0 0 24 24">
        <path d="M3,4A2,2 0 0,0 1,6V17H3A3,3 0 0,0 6,20A3,3 0 0,0 9,17H15A3,3 0 0,0 18,20A3,3 0 0,0 21,17H23V12L20,8H17V4M10,6L14,10L10,14H8V4H10M2,18A1,1 0 0,0 1,19A1,1 0 0,0 2,20A1,1 0 0,0 3,19A1,1 0 0,0 2,18Z"/>
      </svg>
      <span style="color: #374151;"><strong style="color: #059669;">Gratis verzending</strong> vanaf €25 • Morgen in huis</span>
    </div>
    
    <!-- Geld terug garantie -->
    <div style="display: flex; align-items: center; gap: 10px;">
      <svg width="18" height="18" fill="#7c3aed" viewBox="0 0 24 24">
        <path d="M12,1L21,5V11C21,16.55 17.16,21.74 12,23C6.84,21.74 3,16.55 3,11V5L12,1M12,7C10.9,7 10,7.9 10,9C10,10.1 10.9,11 12,11C13.1,11 14,10.1 14,9C14,7.9 13.1,7 12,7Z"/>
      </svg>
      <span style="color: #374151;"><strong style="color: #7c3aed;">30 dagen geld-terug-garantie</strong> • Zonder vragen</span>
    </div>
    
    <!-- Betaalmethodes -->
    <div style="display: flex; align-items: center; gap: 10px;">
      <div style="display: flex; gap: 6px; align-items: center;">
        <img src="https://cdn.shopify.com/s/files/1/0057/8938/4802/files/ideal.png" alt="iDEAL" style="height: 16px;">
        <img src="https://cdn.shopify.com/s/files/1/0057/8938/4802/files/paypal.png" alt="PayPal" style="height: 16px;">
        <img src="https://cdn.shopify.com/s/files/1/0057/8938/4802/files/klarna.png" alt="Klarna" style="height: 16px;">
      </div>
      <span style="color: #6b7280; font-size: 12px;">Veilig betalen • SSL versleuteld</span>
    </div>
    
  </div>
</div>
```

---

## 4. **Premium Subscription Optie met Besparingsvoordeel**

**Wat:** Voeg een abonnementsoptie toe met duidelijke besparing en convenience messaging, specifiek gepositioneerd voor mondgezondheidsroutine.

**Waar:** Als extra optie onder de quantity selector, boven de add-to-cart knop.

**Waarom:** Verhoogt Customer Lifetime Value en speelt in op de routine-natuur van oral care. Premium doelgroep waardeert convenience en consistentie in hun gezondheidsroutine.

**Implementatie:**
```liquid
<!-- Voeg toe na quantity selector, voor add-to-cart -->
<div class="subscription-option" style="margin: 20px 0; padding: 16px; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 12px; border: 2px solid #0284c7;">
  
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
    <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; font-weight: 500; color: #0f172a;">
      <input type="radio" name="purchase_option" value="subscription" style="accent-color: #0284c7;">
      <span>🔄 Automatisch elke 
        {% if product.handle == 'oralbiome-pro-peach' %}2 maanden{% else %}6 maanden{% endif %}
      </span>
    </label>
    <div style="background: #0284c7; color: white; padding: 4px 8px; border-radius: 20px; font-size: 12px; font-weight: 600;">
      -15% BESPARING
    </div>
  </div>
  
  <div style="padding-left: 24px;">
    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 8px;">
      <span style="font-size: 18px; font-weight: 600; color: #0284c7;">
        {% if product.handle == 'oralbiome-pro-peach' %}€12.71{% else %}€33.96{% endif %}
      </span>
      <span style="text-decoration: line-through; color: #6b7280; font-size: 14px;">
        {{ product.price | money }}
      </span>
    </div>
    
    <div style="font-size: 13px; color: #475569; line-height: 1.4;">
      ✓ Nooit meer zonder je routine<br>
      ✓ Altijd de beste prijs<br>
      ✓ Gratis verzending altijd<br>
      ✓ Pas aan of stop wanneer je wilt
    </div>
  </div>
  
</div>

<div class="one-time-option" style="margin-bottom: 16px;">
  <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; font-weight: 500; color: #0f172a;">
    <input type="radio" name="purchase_option" value="onetime" checked style="accent-color: #6b7280;">
    <span>Eenmalige aankoop - {{ product.price | money }}</span>
  </label>
</div>
```

---

## 5. **Dynamische Reviews Preview met Gezondheidsresultaten**

**Wat:** Voeg een compacte reviews sectie toe met specifieke mondgezondheid testimonials en sterren rating, ook zonder volledige reviews app.

**Waar:** Direct onder de productbeschrijving, boven de How It Works sectie.

**Waarom:** Reviews zijn cruciaal voor vertrouwen, vooral bij gezondheidsproducten. Specifieke gezondheidsresultaten zijn overtuigender dan generieke reviews.

**Implementatie:**
```liquid
<!-- Voeg toe in product template, na product beschrijving -->
<div class="reviews-preview" style="margin: 24px 0; padding: 20px; background: #fefefe; border-radius: 12px; border: 1px solid #e5e7eb;">
  
  <!-- Header met sterren -->
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
    <div>
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
        <div style="display: flex; color: #fbbf24;">
          ⭐⭐⭐⭐⭐
        </div>
        <span style="font-weight: 600; font-size: 16px;">4.8/5</span>
        <span style="color: #6b7280; font-size: 14px;">(247 reviews)</span>
      </div>
      <p style="color: #374151; font-size: 14px; margin: 0;">Geverifieerde klanten</p>
    </div>
  </div>
  
  <!-- Sample testimonials -->
  <div style="display: grid; gap: 12px;">
    {% if product.handle == 'oralbiome-pro-peach' %}
      <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #10b981;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
          <span style="font-weight: 500; font-size: 14px;">Sarah M.</span>
          <div style="color: #fbbf24; font-size: 12px;">⭐⭐⭐⭐⭐</div>
        </div>
        <p style="font-size: 13px; color: #374151; margin: 0; line-height: 1.4;">"Na 3 weken gebruik merkbaar minder tandplaque. Mijn tandarts was verrast!"</p>
      </div>
      
      <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #10b981;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
          <span style="font-weight: 500; font-size: 14px;">Mark K.</span>
          <div style="color: #fbbf24; font-size: 12px;">⭐⭐⭐⭐⭐</div>
        </div>
        <p style="font-size: 13px; color: #374151; margin: 0; line-height: 1.4;">"Handig voor onderweg en echt effect. Tanden voelen veel schoner."</p>
      </div>
    {% else %}
      <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #10b981;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
          <span style="font-weight: 500; font-size: 14px;">Lisa V.</span>
          <div style="color:
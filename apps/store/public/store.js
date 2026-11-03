(function () {
  'use strict';
  var state = window.__earshotStore || {};

  // Planted bug 1: grind swatches are divs wired with addEventListener only.
  var form = document.querySelector('.add-form');
  if (form) {
    var hidden = form.querySelector('input[name="grind"]');
    var err = form.querySelector('.grind-error');
    var price = form.querySelector('.buy-row .price');
    var size = form.querySelector('select[name="size"]');
    document.querySelectorAll('.grind-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        document.querySelectorAll('.grind-swatch').forEach(function (o) { o.classList.remove('active'); });
        sw.classList.add('active');
        hidden.value = sw.getAttribute('data-grind');
        state.grind = hidden.value;
        err.hidden = true;
      });
    });
    if (size && price) {
      size.addEventListener('change', function () {
        var text = size.options[size.selectedIndex].text;
        price.textContent = text.split('·')[1].trim();
      });
    }
    form.addEventListener('submit', function (e) {
      if (!hidden.value) {
        e.preventDefault();
        err.textContent = 'Please choose a grind';
        err.hidden = false;
      }
    });
  }

  // Planted bugs 3 + 4: unlabeled inputs and a span "button".
  var checkout = document.querySelector('form.checkout');
  if (checkout) {
    var cerr = checkout.querySelector('.checkout-error');
    var values = function () {
      var o = {};
      checkout.querySelectorAll('input').forEach(function (i) { o[i.name] = i.value; });
      return o;
    };
    var valid = function (d) {
      var card = (d.card || '').replace(/\s+/g, '');
      return !!(d.name || '').trim() && !!(d.address || '').trim() && /^4242\d{12}$/.test(card) && /^(0[1-9]|1[0-2])\/\d{2}$/.test((d.expiry || '').trim());
    };
    var save = function () {
      var d = values();
      state.checkoutValid = valid(d);
      return fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(d),
        credentials: 'same-origin',
        keepalive: true,
      }).then(function (r) { return r.json(); });
    };
    checkout.addEventListener('input', function () { state.checkoutValid = valid(values()); });
    checkout.addEventListener('focusout', function (e) { if (e.target && e.target.tagName === 'INPUT') save(); });
    checkout.addEventListener('submit', function (e) { e.preventDefault(); });
    var go = checkout.querySelector('.btn-primary[data-href]');
    go.addEventListener('click', function () {
      if (!valid(values())) {
        cerr.textContent = 'Please complete all fields with a valid card and expiry (MM/YY).';
        cerr.hidden = false;
        return;
      }
      save().then(function (r) {
        if (r && r.valid) window.location.href = go.getAttribute('data-href');
      });
    });
  }
})();

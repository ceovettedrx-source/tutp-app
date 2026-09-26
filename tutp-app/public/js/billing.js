/* billing.js — per-child plan status on the mother / father / family-member
   dashboards, plus the Renew / buy-Pro checkout (billing stopgap).

   Renders into #billingStatus: one line per child who has ever paid, e.g.
   "Ishika · Pro · active till 26 Oct 2026". Within 5 days of the end, or
   after it, a Renew button appears, but only where the container carries
   data-can-pay="true" (mother and father; a family-member viewer sees the
   status without a payment button). Children who never paid show nothing.

   Checkout reuses the server's Orders flow: POST /api/billing/checkout makes
   the order, Razorpay's own checkout takes the payment, and
   POST /api/billing/verify confirms it right away instead of waiting for the
   webhook. Inline styles only: Tailwind's build scans HTML files, not this
   script, so utility classes used only here would never be generated.

   window.TutpBilling.choosePlan(studentId) is also used by the free-limit
   popup, so hitting the cap leads to a way to pay rather than a dead end,
   and openPlans() by the sidebar's "Explore Pro" button.

   Copy rule: never promise "unlimited". Fair-use caps and per-mode tier
   limits are already decided (docs/pricing-tiers-spec.md), so Pro is
   described by what it includes, not by the absence of limits. */
(function () {
  var CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
  var box = document.getElementById('billingStatus');
  var canPay = !!box && box.getAttribute('data-can-pay') === 'true';
  var plans = [];
  var childrenById = {};

  function familyId() {
    try { return sessionStorage.getItem('tutp_family_id'); } catch (e) { return null; }
  }

  function firstName(name) {
    return String(name || 'Your child').trim().split(/\s+/)[0];
  }

  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) n.style.cssText = style;
    if (text != null) n.textContent = text;
    return n;
  }

  var PILL = 'display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:600;';
  var BTN = 'border:none;border-radius:999px;padding:4px 12px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;background:#005bbf;color:#fff;';

  function render(children) {
    if (!box) return;
    box.innerHTML = '';
    children.filter(function (c) { return c.hasPaid; }).forEach(function (c) {
      var pill = el('div', PILL + (c.active ? 'background:#e8f0fb;color:#004a9c;' : 'background:#fff6e9;color:#7a3d06;'));
      pill.appendChild(el('span', null, c.active
        ? firstName(c.name) + ' · Pro · active till ' + c.paidUntilLabel
        : firstName(c.name) + ' · Pro ended ' + c.paidUntilLabel));
      if (c.showRenew && canPay) {
        var btn = el('button', BTN, 'Renew');
        btn.type = 'button';
        btn.addEventListener('click', function () { choosePlan(c.studentId); });
        pill.appendChild(btn);
      }
      box.appendChild(pill);
    });
  }

  function refresh() {
    var fid = familyId();
    if (!fid) return Promise.resolve();
    return fetch('/api/billing/status/' + encodeURIComponent(fid), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('Request failed'); return res.json(); })
      .then(function (data) {
        plans = data.plans || [];
        childrenById = {};
        (data.children || []).forEach(function (c) { childrenById[c.studentId] = c; });
        render(data.children || []);
      })
      .catch(function (err) { console.error('[billing] Could not load plan status:', err); });
  }

  function loadCheckoutScript() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = CHECKOUT_SRC;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load the payment page')); };
      document.head.appendChild(s);
    });
  }

  function closeChooser() {
    var old = document.getElementById('billingChooser');
    if (old) old.remove();
  }

  // Small plan picker: Pro monthly or Annual Pro, for one child.
  function choosePlan(studentId) {
    closeChooser();
    var child = childrenById[studentId];
    var wrap = el('div', 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;');
    wrap.id = 'billingChooser';
    var card = el('div', 'background:#fff;border-radius:16px;padding:20px;max-width:360px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.2);font-family:inherit;color:#181c20;');
    card.appendChild(el('h3', 'margin:0 0 4px;font-size:18px;font-weight:700;', 'Tut-P Pro' + (child ? ' for ' + firstName(child.name) : '')));
    card.appendChild(el('p', 'margin:0 0 14px;font-size:13px;color:#4b5566;', child && child.active
      ? 'Renewing adds to the current plan, which runs till ' + child.paidUntilLabel + '.'
      : 'Homework Help for every subject, Quiz and Storytelling for this child.'));
    var status = el('p', 'margin:10px 0 0;font-size:13px;color:#b3261e;');
    (plans.length ? plans : [{ key: 'pro_monthly', label: 'Pro · ₹500/month' }]).forEach(function (p) {
      var b = el('button', 'display:block;width:100%;margin:0 0 8px;padding:12px;border-radius:12px;border:2px solid #005bbf;background:#fff;color:#004a9c;font:inherit;font-size:15px;font-weight:700;cursor:pointer;', p.label);
      b.type = 'button';
      b.addEventListener('click', function () { checkout(studentId, p.key, status); });
      card.appendChild(b);
    });
    var policy = el('a', 'display:block;margin:4px 0 10px;font-size:12px;color:#005bbf;', 'Plans don’t renew automatically. Refund policy');
    policy.href = '/refund-policy/';
    policy.target = '_blank';
    policy.rel = 'noopener';
    card.appendChild(policy);
    var cancel = el('button', 'background:none;border:none;color:#4b5566;font:inherit;font-size:13px;cursor:pointer;padding:4px 0;', 'Not now');
    cancel.type = 'button';
    cancel.addEventListener('click', closeChooser);
    card.appendChild(cancel);
    card.appendChild(status);
    wrap.appendChild(card);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeChooser(); });
    document.body.appendChild(wrap);
  }

  function checkout(studentId, planKey, statusEl) {
    statusEl.style.color = '#4b5566';
    statusEl.textContent = 'Opening payment…';
    var order;
    fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: studentId, plan: planKey })
    })
      .then(function (res) { return res.json().then(function (d) { if (!res.ok) throw new Error(d.error || 'Could not start the payment'); return d; }); })
      .then(function (d) { order = d; return loadCheckoutScript(); })
      .then(function () {
        closeChooser();
        var rzp = new window.Razorpay({
          key: order.razorpayKeyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: 'Tut-P',
          description: order.planLabel,
          handler: function (resp) {
            fetch('/api/billing/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature })
            })
              .catch(function (err) { console.error('[billing] Verify failed (the webhook will still complete it):', err); })
              .then(refresh);
          }
        });
        rzp.open();
      })
      .catch(function (err) {
        statusEl.style.color = '#b3261e';
        statusEl.textContent = err.message || 'Could not start the payment. Please try again.';
      });
  }

  // Sidebar "Explore Pro": plans for the child currently selected on this
  // dashboard. A viewer who can't pay (family member) is pointed to a parent.
  function openPlans() {
    var studentId = null;
    try { studentId = sessionStorage.getItem('tutp_student_id'); } catch (e) {}
    if (canPay && studentId) { choosePlan(studentId); return; }
    alert(canPay ? 'Add your child first, then choose a plan for them.' : "Pro is bought from a parent's dashboard.");
  }

  window.TutpBilling = { refresh: refresh, choosePlan: choosePlan, openPlans: openPlans, canPay: canPay };
  refresh();
})();

// Runs in the page's main world. Content scripts can't see React's expando
// keys (isolated world), so content.js dispatches a "bp-probe" event on an
// input and we tag it once React has hydrated it.
document.addEventListener('bp-probe', (e) => {
  const el = e.target;
  if (Object.keys(el).some((k) => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'))) {
    el.setAttribute('data-bp-react', '1');
  }
}, true);

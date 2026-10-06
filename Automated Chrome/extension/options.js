'use strict';
const $ = (id) => document.getElementById(id);

(async () => {
  const cfg = await BP.getConfig();
  $('name').value = cfg.name;
  $('phone').value = cfg.phone;
  $('email').value = cfg.email;
  $('windows').value = BP.formatWindows(cfg.windows);
  $('lead').value = cfg.leadMinutes;
  $('onlyInWindows').checked = cfg.onlyInWindows;
  $('autoSubmit').checked = cfg.autoSubmit;
  $('armed').checked = cfg.armed;
})();

$('save').onclick = async () => {
  try {
    const name = $('name').value.trim();
    if (!name) throw new Error('Name is required by the form.');
    await BP.setConfig({
      name,
      phone: $('phone').value.trim(),
      email: $('email').value.trim(),
      windows: BP.parseWindows($('windows').value),
      leadMinutes: Math.max(0, parseInt($('lead').value, 10) || 0),
      onlyInWindows: $('onlyInWindows').checked,
      autoSubmit: $('autoSubmit').checked,
      armed: $('armed').checked,
    });
    $('msg').textContent = 'Saved ✓';
  } catch (e) {
    $('msg').textContent = e.message;
  }
};

/* Release countdown in the banner. Without JavaScript the banner keeps its static sentence. */
(function () {
  var RELEASE_AT = Date.parse('2026-12-01T00:00:00+01:00'); // launch day, midnight Central European Time
  var countdown = document.querySelector('.release-countdown');
  var text = document.querySelector('.release-alert__text');
  if (!countdown || !text) return;

  var units = {};
  countdown.querySelectorAll('[data-unit]').forEach(function (el) { units[el.dataset.unit] = el; });

  function pad(n) { return String(n).padStart(2, '0'); }

  function tick() {
    var seconds = Math.floor((RELEASE_AT - Date.now()) / 1000);
    if (seconds > 0) {
      units.days.textContent = pad(Math.floor(seconds / 86400));
      units.hours.textContent = pad(Math.floor(seconds % 86400 / 3600));
      units.minutes.textContent = pad(Math.floor(seconds % 3600 / 60));
      units.seconds.textContent = pad(seconds % 60);
      return;
    }
    clearInterval(timer);
    countdown.hidden = true;
    text.hidden = false;
    text.textContent = 'JOSIE-Voice launches today.';
  }

  text.hidden = true;
  countdown.hidden = false;
  var timer = setInterval(tick, 1000);
  tick();
})();

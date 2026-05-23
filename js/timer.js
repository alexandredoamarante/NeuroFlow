const Timer = {
  minutesEl: document.getElementById('timerMinutes'),
  displayEl: document.getElementById('timerInner'),
  ringEl: document.getElementById('ringProgress'),
  sessionEl: document.getElementById('sessionCount'),

  timeLeft: 25 * 60,
  totalTime: 25 * 60,
  timerId: null,
  sessions: 0,

  init() {
    if (!this.displayEl) return;
    this.updateDisplay();

    document.getElementById('timerStart').onclick = () => this.start();
    document.getElementById('timerPause').onclick = () => this.pause();
    document.getElementById('timerReset').onclick = () => this.reset();
    document.getElementById('timerSetBtn').onclick = () => this.setDuration();
  },

  updateDisplay() {
    const mins = Math.floor(this.timeLeft / 60);
    const secs = this.timeLeft % 60;
    this.displayEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    const offset = 326.7 - (326.7 * (this.timeLeft / this.totalTime));
    this.ringEl.style.strokeDashoffset = offset;
  },

  start() {
    if (this.timerId) return;
    this.timerId = setInterval(() => {
      this.timeLeft--;
      this.updateDisplay();
      if (this.timeLeft <= 0) {
        clearInterval(this.timerId);
        this.timerId = null;
        this.sessions++;
        this.sessionEl.textContent = this.sessions;
        this.reset();
      }
    }, 1000);
  },

  pause() {
    clearInterval(this.timerId);
    this.timerId = null;
  },

  reset() {
    this.pause();
    this.timeLeft = this.totalTime;
    this.updateDisplay();
  },

  setDuration() {
    const mins = parseInt(this.minutesEl.value);
    if (mins > 0) {
      this.totalTime = mins * 60;
      this.reset();
    }
  }
};

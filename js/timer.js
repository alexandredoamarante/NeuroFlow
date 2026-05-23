let timerInterval;
let timeLeft = 25 * 60;
let isPaused = true;
let currentDuration = 25;

const timerInner = document.getElementById('timerInner');
const ringProgress = document.getElementById('ringProgress');
const sessionCount = document.getElementById('sessionCount');
const timerMinutes = document.getElementById('timerMinutes');
const timerSetBtn = document.getElementById('timerSetBtn');
const timerStart = document.getElementById('timerStart');
const timerPause = document.getElementById('timerPause');
const timerReset = document.getElementById('timerReset');
const timerToggleBtn = document.getElementById('timerToggleBtn');
const timerBody = document.getElementById('timerBody');

timerToggleBtn?.addEventListener('click', () => {
  const isHidden = window.getComputedStyle(timerBody).display === 'none';
  timerBody.style.display = isHidden ? 'block' : 'none';
});

function updateTimerDisplay() {
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  timerInner.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  const total = currentDuration * 60;
  const offset = 326.7 - (326.7 * (total - timeLeft) / total);
  ringProgress.style.strokeDashoffset = offset;
}

function startTimer() {
  if (!isPaused) return;
  isPaused = false;
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      isPaused = true;
      completeSession();
    }
  }, 1000);
}

function pauseTimer() {
  isPaused = true;
  clearInterval(timerInterval);
}

function resetTimer() {
  pauseTimer();
  timeLeft = currentDuration * 60;
  updateTimerDisplay();
}

function completeSession() {
  const id = new URLSearchParams(window.location.search).get('id');
  const task = Storage.getTask(id);
  task.sessions = (task.sessions || 0) + 1;
  Storage.saveTask(task);

  // Also update local task object if we are on the task page
  if (window.currentTask && window.currentTask.id === id) {
    window.currentTask.sessions = task.sessions;
  }

  sessionCount.textContent = task.sessions;
  resetTimer();
  alert('Sessão completada!');
}

timerSetBtn?.addEventListener('click', () => {
  const val = parseInt(timerMinutes.value);
  if (val > 0) {
    currentDuration = val;
    resetTimer();
  }
});

timerStart?.addEventListener('click', startTimer);
timerPause?.addEventListener('click', pauseTimer);
timerReset?.addEventListener('click', resetTimer);

function initTimer(task) {
  sessionCount.textContent = task.sessions || 0;
  updateTimerDisplay();
}

const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

function setTheme(theme) {
  html.setAttribute('data-theme', theme);
  localStorage.setItem('neuroflow_theme', theme);
}

themeToggle?.addEventListener('click', () => {
  const current = html.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// Init Theme
const savedTheme = localStorage.getItem('neuroflow_theme') || 'dark';
setTheme(savedTheme);

// Info Modal Logic
const infoToggle = document.getElementById('infoToggle');
const infoModal = document.getElementById('infoModal');
const infoClose = document.getElementById('infoClose');

infoToggle?.addEventListener('click', () => {
  if (infoModal) infoModal.style.display = 'flex';
});

infoClose?.addEventListener('click', () => {
  if (infoModal) infoModal.style.display = 'none';
});

infoModal?.addEventListener('click', (e) => {
  if (e.target === infoModal) infoModal.style.display = 'none';
});

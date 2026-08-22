const errors = {
  oauth: 'Sign-in was interrupted. Try Google, GitHub, or Proton again.',
  google: 'Google sign-in was cancelled or is not ready on this site yet.',
  github: 'GitHub sign-in was cancelled or is not ready on this site yet.',
  proton: 'Proton sign-in was cancelled or is not ready on this site yet.'
};
const errorBox = document.querySelector('#error');
const params = new URLSearchParams(location.search);
if (errorBox && params.get('error')) errorBox.textContent = errors[params.get('error')] || errors.oauth;

if (window.TRACKZ_STATIC) {
  const note = document.querySelector('.switch');
  if (note) {
    note.textContent = 'This GitHub Pages site keeps your workspace in this browser only.';
  }
  document.querySelectorAll('.oauth-btn').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      const provider = href.includes('google') ? 'google' : href.includes('proton') ? 'proton' : 'github';
      staticLogin(provider);
      location.href = page('dashboard.html');
    });
  });
}

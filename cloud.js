// Firebase auth + Firestore sync layer.
// Gates each page behind Google sign-in, loads the signed-in user's data
// from Firestore into app.js's in-memory state, and pushes changes back.
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

const USERS_COLLECTION = 'albumFlowUsers';

let currentUser = null;
let saveTimer = null;

function userDocRef(uid) {
  return db.collection(USERS_COLLECTION).doc(uid);
}

async function loadCloudStateFromFirestore(uid) {
  const snap = await userDocRef(uid).get();
  if (!snap.exists) {
    return { songs: [], labelColors: {}, labelCategories: {} };
  }
  const data = snap.data();
  return {
    songs: Array.isArray(data.songs) ? data.songs : [],
    labelColors: data.labelColors && typeof data.labelColors === 'object' ? data.labelColors : {},
    labelCategories: data.labelCategories && typeof data.labelCategories === 'object' ? data.labelCategories : {},
  };
}

function scheduleCloudSave() {
  if (!currentUser) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    userDocRef(currentUser.uid)
      .set(getCloudState(), { merge: true })
      .catch((e) => console.error('Failed to save to Firestore', e));
  }, 400);
}

function signInWithGoogle() {
  // Popup rather than redirect: redirect sign-in depends on cross-domain
  // storage between this app's origin and the *.firebaseapp.com authDomain,
  // which modern browsers' third-party storage blocking can silently break
  // (login appears to work but the session never comes back). Popup avoids
  // that handoff, and isn't blocked here since it's opened synchronously
  // from a real click.
  return auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
}

function signOutUser() {
  return auth.signOut();
}

// Gates the page behind sign-in. Calls `onSignedIn` (once per sign-in) after
// the user's Firestore data has been loaded into app.js's in-memory state.
function initAuthGate(onSignedIn) {
  const overlay = document.getElementById('auth-gate');
  const loginBox = document.getElementById('auth-login-prompt');
  const overlayStatus = document.getElementById('auth-gate-status');
  const loginBtn = document.getElementById('btn-google-login');
  const userInfo = document.getElementById('auth-user-info');
  const logoutBtn = document.getElementById('btn-logout');

  window.__onStateChanged = scheduleCloudSave;

  loginBtn.addEventListener('click', () => {
    loginBtn.disabled = true;
    overlayStatus.textContent = '';
    signInWithGoogle().catch((e) => {
      overlayStatus.textContent = `ログインに失敗しました: ${e.message}`;
      loginBtn.disabled = false;
    });
  });

  logoutBtn.addEventListener('click', () => {
    signOutUser();
  });

  let started = false;

  auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    if (user) {
      // Already signed in (the common case on every page navigation) — keep
      // the overlay blank (no card, no text) while the user's data loads
      // from Firestore, instead of showing/flashing the login prompt.
      loginBox.style.display = 'none';
      userInfo.textContent = user.displayName || user.email || '';
      logoutBtn.style.display = 'inline-block';
      try {
        const state = await loadCloudStateFromFirestore(user.uid);
        setCloudState(state);
        overlay.style.display = 'none';
        if (!started) {
          started = true;
          onSignedIn();
        }
      } catch (e) {
        loginBox.style.display = 'block';
        overlayStatus.textContent = `データの読み込みに失敗しました: ${e.message}`;
      }
    } else {
      overlay.style.display = 'flex';
      loginBox.style.display = 'block';
      overlayStatus.textContent = '';
      loginBtn.disabled = false;
      userInfo.textContent = '';
      logoutBtn.style.display = 'none';
    }
  });
}

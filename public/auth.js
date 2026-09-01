const form = document.getElementById("authForm");
const email = document.getElementById("email");
const name = document.getElementById("name");
const password = document.getElementById("password");
const nameField = document.getElementById("nameField");
const error = document.getElementById("authError");
const submit = document.getElementById("submitButton");
const switchButton = document.getElementById("switchButton");
const formTitle = document.getElementById("formTitle");
const formSubtitle = document.getElementById("formSubtitle");
const switchText = document.getElementById("switchText");
let registerMode = false;

function renderMode() {
  formTitle.textContent = registerMode ? "Create account" : "Sign in";
  formSubtitle.textContent = registerMode
    ? "Make a private space for your music."
    : "Log in to enter your personal music player.";
  nameField.classList.toggle("hidden", !registerMode);
  name.required = registerMode;
  submit.innerHTML = registerMode
    ? "Create account <span>→</span>"
    : "Sign in <span>→</span>";
  switchText.textContent = registerMode
    ? "Already have an account?"
    : "New to VOID?";
  switchButton.textContent = registerMode ? "Sign in" : "Create an account";
  password.autocomplete = registerMode ? "new-password" : "current-password";
  error.textContent = "";
}

switchButton.addEventListener("click", () => {
  registerMode = !registerMode;
  renderMode();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  try {
    const response = await fetch(
      `/api/auth/${registerMode ? "register" : "login"}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.value,
          email: email.value,
          password: password.value,
        }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to authenticate.");
    localStorage.setItem("voidUser", JSON.stringify(data.user));
    window.location.href = "/";
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});

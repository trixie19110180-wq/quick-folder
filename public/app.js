function activeForm() {
  return document.querySelector(".composer:not(.hidden)");
}

function setMessage(form, message, isError) {
  const target = form.querySelector(".form-message");
  if (!target) return;
  target.textContent = message || "";
  target.classList.toggle("error", Boolean(isError));
}

function updatePasswordFields(form) {
  const protectedInput = form.querySelector('input[name="visibility"][value="protected"]');
  const passwordField = form.querySelector(".password-field");
  const passwordInput = form.querySelector('input[name="password"]');
  const locked = protectedInput && protectedInput.checked;
  if (passwordField) passwordField.classList.toggle("hidden", !locked);
  if (passwordInput) passwordInput.required = Boolean(locked);
}

function submitWithProgress(form, url) {
  const progress = form.querySelector(".progress");
  const data = new FormData(form);
  const request = new XMLHttpRequest();

  setMessage(form, "Uploading...", false);
  if (progress) {
    progress.hidden = false;
    progress.value = 0;
  }

  request.upload.addEventListener("progress", (event) => {
    if (!progress || !event.lengthComputable) return;
    progress.value = Math.round((event.loaded / event.total) * 100);
  });

  request.addEventListener("load", () => {
    let payload = {};
    try {
      payload = JSON.parse(request.responseText);
    } catch (_error) {
      payload = {};
    }
    if (request.status >= 200 && request.status < 300 && payload.url) {
      window.location.href = payload.url;
      return;
    }
    setMessage(form, payload.error || "The post could not be created.", true);
    if (progress) progress.hidden = true;
  });

  request.addEventListener("error", () => {
    setMessage(form, "Network error. Try again.", true);
    if (progress) progress.hidden = true;
  });

  request.open("POST", url);
  request.send(data);
}

document.querySelectorAll(".choice").forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    document.querySelectorAll(".choice").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelector("#file-form")?.classList.toggle("hidden", mode !== "file");
    document.querySelector("#text-form")?.classList.toggle("hidden", mode !== "text");
  });
});

document.querySelectorAll(".composer").forEach((form) => {
  updatePasswordFields(form);
  form.addEventListener("change", () => updatePasswordFields(form));
});

document.querySelector("#file-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitWithProgress(event.currentTarget, "/api/posts/files");
});

document.querySelector("#text-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitWithProgress(event.currentTarget, "/api/posts/text");
});

document.querySelector("#load-text")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const output = document.querySelector("#text-output");
  button.disabled = true;
  button.textContent = "Loading...";
  try {
    const response = await fetch(`/api/posts/${button.dataset.slug}/text`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load text.");
    output.textContent = payload.text;
    button.textContent = "Text loaded";
  } catch (error) {
    output.textContent = error.message;
    button.disabled = false;
    button.textContent = "Load text";
  }
});

document.querySelectorAll("form[data-confirm]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    if (!window.confirm(form.dataset.confirm)) {
      event.preventDefault();
    }
  });
});

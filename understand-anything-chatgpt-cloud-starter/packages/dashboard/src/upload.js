const pageUrl = new URL(location.href);
const parameters = pageUrl.hash ? new URLSearchParams(pageUrl.hash.slice(1)) : pageUrl.searchParams;
const uploadUrl = parameters.get('upload_url');
const projectId = parameters.get('project_id');
const form = document.getElementById('upload-form');
const fileInput = document.getElementById('upload-file');
const status = document.getElementById('upload-status');
const project = document.getElementById('upload-project');
const button = document.getElementById('upload-button');

project.textContent = projectId ? `Project: ${projectId}` : '';
history.replaceState({}, document.title, '/upload.html');

if (!uploadUrl || !projectId) {
  status.textContent = 'This upload link is incomplete. Create a new upload session from the Custom GPT.';
  status.dataset.kind = 'error';
  form.hidden = true;
} else {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith('.zip')) {
      status.textContent = 'Select one .zip archive.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Uploading…';
    try {
      const target = new URL(uploadUrl);
      const uploadToken = new URLSearchParams(target.hash.slice(1)).get('token') ?? target.searchParams.get('token');
      target.hash = '';
      target.searchParams.delete('token');
      const response = await fetch(target, { method: 'PUT', headers: { 'content-type': 'application/zip', 'x-upload-token': uploadToken }, body: file });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? `Upload failed with status ${response.status}`);
      status.textContent = `Upload complete. Return to ChatGPT and start analysis for project ${body.project_id}.`;
      form.hidden = true;
    } catch (error) {
      status.textContent = error.message;
      status.dataset.kind = 'error';
      button.disabled = false;
    }
  });
}

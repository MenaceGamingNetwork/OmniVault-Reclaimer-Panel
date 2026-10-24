'use strict';

const form = document.querySelector('#connection-form');
const list = document.querySelector('#connection-list');
const emptyState = document.querySelector('#empty-state');
const errorLabel = document.querySelector('#form-error');
const toast = document.querySelector('#toast');
let toastTimer;

function showToast(message, error = false) {
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

function addText(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

async function refreshConnections() {
  const connections = await window.controlApp.listConnections();
  list.replaceChildren();
  emptyState.hidden = connections.length > 0;

  for (const connection of connections) {
    const row = document.createElement('article');
    row.className = 'connection';
    const details = document.createElement('div');
    details.className = 'connection-details';
    addText(details, 'strong', 'connection-name', connection.label);
    addText(details, 'span', 'connection-address', connection.serverOrigin);
    row.append(details);

    const actions = document.createElement('div');
    actions.className = 'connection-actions';
    const connect = document.createElement('button');
    connect.className = 'primary';
    connect.type = 'button';
    connect.textContent = 'Connect';
    connect.addEventListener('click', async () => {
      connect.disabled = true;
      try {
        await window.controlApp.connect(connection.id);
      } catch (error) {
        showToast(error.message, true);
        connect.disabled = false;
      }
    });
    const remove = document.createElement('button');
    remove.className = 'quiet';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      try {
        await window.controlApp.removeConnection(connection.id);
        await refreshConnections();
      } catch (error) {
        showToast(error.message, true);
      }
    });
    actions.append(connect, remove);
    row.append(actions);
    list.append(row);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorLabel.hidden = true;
  const formData = new FormData(form);
  try {
    await window.controlApp.saveConnection({
      label: formData.get('label'),
      serverOrigin: formData.get('serverOrigin'),
      certificateFingerprint: formData.get('certificateFingerprint'),
    });
    form.reset();
    showToast('Server connection saved.');
    await refreshConnections();
  } catch (error) {
    errorLabel.textContent = error.message;
    errorLabel.hidden = false;
  }
});

document.querySelector('#refresh').addEventListener('click', () => {
  refreshConnections().catch((error) => showToast(error.message, true));
});

refreshConnections().catch((error) => showToast(error.message, true));

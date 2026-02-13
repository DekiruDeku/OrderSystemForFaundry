/**
 * OrderMultiTargetPicker.js
 * Диалог подтверждения списка целей: можно убрать/добавить текущие T-цели.
 */

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function renderRow(tok) {
  const id = String(tok?.id ?? "");
  const name = escapeHtml(tok?.name ?? "—");
  const img = escapeHtml(tok?.document?.texture?.src ?? tok?.actor?.img ?? "");

  return `
    <div class="order-mt-row" data-token-id="${id}" style="display:flex; align-items:center; gap:8px; margin:4px 0;">
      <label style="display:flex; align-items:center; gap:8px; flex:1;">
        <input type="checkbox" name="orderMtTarget" value="${id}" checked />
        <img src="${img}" width="24" height="24" style="object-fit:cover; border-radius:4px;" />
        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</span>
      </label>
      <button type="button" class="order-mt-remove" title="Убрать" style="flex:0 0 auto;">✕</button>
    </div>
  `;
}

function collectCheckedIds(html) {
  const ids = [];
  html.find('input[name="orderMtTarget"]:checked').each((_, el) => {
    ids.push(String(el.value));
  });
  return ids;
}

export async function pickTargetsDialog({
  title = "Цели",
  initialTokens = [],
  allowAddTargets = true
} = {}) {
  const unique = new Map();
  for (const t of initialTokens) {
    if (t?.id) unique.set(String(t.id), t);
  }

  const content = `
    <form class="order-multi-target-picker">
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
        <button type="button" class="order-mt-select-all">Выбрать всё</button>
        <button type="button" class="order-mt-unselect-all">Снять всё</button>
        ${allowAddTargets ? `<button type="button" class="order-mt-add" title="Добавить текущие цели (T)">+ Добавить выделенные (T)</button>` : ""}
      </div>
      <div class="order-mt-list" style="max-height:280px; overflow:auto; padding-right:4px;">
        ${Array.from(unique.values()).map(renderRow).join("") || `<div style="opacity:.7;">Нет целей в области</div>`}
      </div>
      <p style="font-size:12px; opacity:.75; margin-top:8px;">
        Подсказка: можно убрать цели галочкой или крестиком. «Добавить выделенные» добавит текущие цели, выбранные клавишей T.
      </p>
    </form>
  `;

  return await new Promise((resolve) => {
    const dlg = new Dialog({
      title,
      content,
      buttons: {
        ok: { label: "ОК", callback: (html) => resolve(collectCheckedIds(html)) },
        cancel: { label: "Отмена", callback: () => resolve([]) }
      },
      default: "ok",
      close: () => resolve([]),
      render: (html) => {
        const list = html.find('.order-mt-list');

        const syncEmpty = () => {
          if (!list.children('.order-mt-row').length) {
            list.html('<div style="opacity:.7;">Нет целей</div>');
          }
        };

        html.on('click', '.order-mt-remove', (ev) => {
          ev.preventDefault();
          const row = $(ev.currentTarget).closest('.order-mt-row');
          const id = String(row.data('tokenId') ?? row.attr('data-token-id') ?? "");
          unique.delete(id);
          row.remove();
          syncEmpty();
        });

        html.on('click', '.order-mt-select-all', (ev) => {
          ev.preventDefault();
          html.find('input[name="orderMtTarget"]').prop('checked', true);
        });

        html.on('click', '.order-mt-unselect-all', (ev) => {
          ev.preventDefault();
          html.find('input[name="orderMtTarget"]').prop('checked', false);
        });

        if (allowAddTargets) {
          html.on('click', '.order-mt-add', (ev) => {
            ev.preventDefault();
            const targets = Array.from(game.user?.targets ?? []);
            for (const tok of targets) {
              if (!tok?.id) continue;
              const id = String(tok.id);
              if (unique.has(id)) continue;
              unique.set(id, tok);
              if (!list.children('.order-mt-row').length) list.empty();
              list.append(renderRow(tok));
            }
          });
        }
      }
    });

    dlg.render(true);
  });
}
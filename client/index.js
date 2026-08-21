// control-dsh-plugin client 半区（浏览器端）v0.8：
//   sidebar 注入 "▤ Control" 导航项
//   点击后在 centerCol 直接渲染 Dashboard（非 iframe，复用 DSH CSS 变量）
// 经 dsh-client-modules boot graph 加载。
window.__ModuleLoader__.load({
	id: "control-dsh-plugin",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;

		const name = "control-ui";
		const inject = [];

		// ── i18n 字典 ──────────────────────────────────────────
		const NS = 'control';
		const zh = {
			'sidebar.label': 'Control',
			'sidebar.title': 'control 任务看板',
			'dashboard.title': '🎛️ Control Platform',
			'dashboard.status.loading': '加载中...',
			'dashboard.status.connected': '已连接',
			'dashboard.tab.tasks': '任务',
			'dashboard.tab.approvals': '审批',
			'dashboard.tab.audit': '审计',
			'dashboard.empty.tasks': '暂无任务',
			'dashboard.empty.approvals': '暂无待审批',
			'dashboard.empty.audit': '暂无审计记录',
			'dashboard.error.load': '加载失败',
			'dashboard.table.id': 'ID',
			'dashboard.table.title': '标题',
			'dashboard.table.stage': '阶段',
			'dashboard.table.status': '状态',
			'dashboard.table.updated': '更新时间',
			'dashboard.table.task': '任务',
			'dashboard.table.action': '动作',
			'dashboard.table.operator': '操作人',
			'dashboard.table.time': '时间',
			'dashboard.card.role': '角色',
		};
		const en = {
			'sidebar.label': 'Control',
			'sidebar.title': 'control task board',
			'dashboard.title': '🎛️ Control Platform',
			'dashboard.status.loading': 'Loading...',
			'dashboard.status.connected': 'Connected',
			'dashboard.tab.tasks': 'Tasks',
			'dashboard.tab.approvals': 'Approvals',
			'dashboard.tab.audit': 'Audit',
			'dashboard.empty.tasks': 'No tasks',
			'dashboard.empty.approvals': 'No pending approvals',
			'dashboard.empty.audit': 'No audit entries',
			'dashboard.error.load': 'Failed to load',
			'dashboard.table.id': 'ID',
			'dashboard.table.title': 'Title',
			'dashboard.table.stage': 'Stage',
			'dashboard.table.status': 'Status',
			'dashboard.table.updated': 'Updated',
			'dashboard.table.task': 'Task',
			'dashboard.table.action': 'Action',
			'dashboard.table.operator': 'Operator',
			'dashboard.table.time': 'Time',
			'dashboard.card.role': 'Role',
		};

		function apply() {
			if (typeof document === "undefined") return;
			const API_PREFIX = "/control/dashboard/api";

			// 检测语言：优先 DSH html lang 属性，其次浏览器语言
			const htmlLang = document.documentElement.lang || '';
			const browserLang = navigator.language || '';
			const rawLang = htmlLang || browserLang || 'zh';
			const lang = rawLang.startsWith('zh') ? 'zh' : 'en';
			console.log('[control-dsh-plugin] locale detected:', { htmlLang, browserLang, resolved: lang });
			const t = (key) => (lang === 'zh' ? zh : en)[key] || key;

			// ── 工具 ─────────────────────────────────────────────
			async function fetchCount() {
				try {
					const res = await fetch(`${API_PREFIX}/approvals/pending`, { cache: "no-store" });
					if (!res.ok) return null;
					const rows = await res.json();
					return Array.isArray(rows) ? rows.length : 0;
				} catch { return null; }
			}

			// ── 1) sidebar 导航项 ────────────────────────────────
			let sidebarItem = null;
			let badgeTimer = null;

			async function refreshBadge() {
				const count = await fetchCount();
				const text = count === null ? "–" : String(count);
				if (sidebarItem) {
					const badge = sidebarItem.querySelector("[data-control-sidebar-count]");
					if (badge) badge.textContent = text;
				}
			}

			function findSidebarRegion() {
				const areas = document.querySelectorAll('[class$="_regionArea"]');
				for (const el of areas) {
					if (el.querySelector('[class$="_newSession"]') || el.querySelector('[class$="_settingsArea"]')) continue;
					return el;
				}
				return null;
			}

			// ── 2) centerCol 视图切换 ────────────────────────────
			let controlView = null;
			let isControlActive = false;

			function findCenterCol() {
				const cols = document.querySelectorAll('[class*="_centerCol"]');
				for (const el of cols) {
					if (el.closest('[class*="_frame"]')) return el;
				}
				return null;
			}

			// 渲染 Dashboard HTML（直接插入 DSH DOM，复用 CSS 变量）
			function renderDashboard(container) {
				container.innerHTML = `
					<div class="header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l2)">
						<h1 style="font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)">${t('dashboard.title')}</h1>
						<span id="control-status" style="font-size:12px;color:var(--dsw-alias-label-tertiary)">${t('dashboard.status.loading')}</span>
					</div>
					<div class="tabs" style="display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:8px">
						<button class="control-tab active" data-tab="tasks" style="padding:6px 14px;background:transparent;border:none;border-bottom:2px solid var(--dsw-accent);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px;transition:all 0.15s;margin-bottom:-10px">${t('dashboard.tab.tasks')}</button>
						<button class="control-tab" data-tab="approvals" style="padding:6px 14px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;transition:all 0.15s;margin-bottom:-10px">${t('dashboard.tab.approvals')}</button>
						<button class="control-tab" data-tab="audit" style="padding:6px 14px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;transition:all 0.15s;margin-bottom:-10px">${t('dashboard.tab.audit')}</button>
					</div>
					<div id="control-content" style="overflow:auto">
						<div style="text-align:center;padding:40px;color:var(--dsw-alias-label-tertiary)">${t('dashboard.status.loading')}</div>
					</div>
				`;

				// 绑定标签切换
				container.querySelectorAll('.control-tab').forEach(tab => {
					tab.addEventListener('click', (e) => {
						container.querySelectorAll('.control-tab').forEach(t => {
							t.style.borderBottomColor = 'transparent';
							t.style.color = 'var(--dsw-alias-label-secondary)';
						});
						e.target.style.borderBottomColor = 'var(--dsw-accent)';
						e.target.style.color = 'var(--dsw-alias-label-primary)';
						const tabName = e.target.dataset.tab;
						if (tabName === 'tasks') loadTasks(container);
						else if (tabName === 'approvals') loadApprovals(container);
						else if (tabName === 'audit') loadAudit(container);
					});
				});

				// 加载初始数据
				loadTasks(container);
			}

			async function loadTasks(container) {
				const content = container.querySelector('#control-content');
				if (!content) return;
				content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dsw-alias-label-tertiary)">${t('dashboard.status.loading')}</div>`;
				try {
					const res = await fetch(`${API_PREFIX}/tasks`);
					const tasks = await res.json();
					if (!tasks.length) {
						content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dsw-alias-label-tertiary)">${t('dashboard.empty.tasks')}</div>`;
						return;
					}
					let html = `<table style="width:100%;border-collapse:collapse;font-size:13px">
						<tr style="border-bottom:1px solid var(--dsw-alias-border-l2)">
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.id')}</th>
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.title')}</th>
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.stage')}</th>
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.status')}</th>
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.updated')}</th>
						</tr>`;
					tasks.forEach(task => {
						const statusColor = {
							'pending': 'rgba(240,136,62,0.15);color:#f0883e',
							'running': 'rgba(63,185,80,0.15);color:#3fb950',
							'awaiting_approval': 'rgba(163,113,247,0.15);color:#a371f7',
							'delivered': 'rgba(88,166,255,0.15);color:#58a6ff'
						}[task.status] || '';
						html += `<tr style="border-bottom:1px solid var(--dsw-alias-border-l2)">
							<td style="padding:8px 12px">${task.task_id}</td>
							<td style="padding:8px 12px">${task.title}</td>
							<td style="padding:8px 12px">${task.stage || '-'}</td>
							<td style="padding:8px 12px"><span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:500;${statusColor ? 'background:' + statusColor.split(';')[0] + ';color:' + statusColor.split(';')[1] : ''}">${task.status}</span></td>
							<td style="padding:8px 12px">${new Date(task.updated_at).toLocaleDateString()}</td>
						</tr>`;
					});
					html += '</table>';
					content.innerHTML = html;
				} catch (err) {
					content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dsw-error)">${err.message}</div>`;
				}
				container.querySelector('#control-status').textContent = t('dashboard.status.connected');
			}

			async function loadApprovals(container) {
				const content = container.querySelector('#control-content');
				if (!content) return;
				content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dsw-alias-label-tertiary)">${t('dashboard.status.loading')}</div>`;
				try {
					const res = await fetch(`${API_PREFIX}/approvals/pending`);
					const approvals = await res.json();
					if (!approvals.length) {
						content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dsw-alias-label-tertiary)">${t('dashboard.empty.approvals')}</div>`;
						return;
					}
					let html = '';
					approvals.forEach(a => {
						html += `<div style="background:var(--dsw-alias-surface-elevated);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:12px;margin-bottom:8px">
							<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
								<span style="font-weight:600;color:var(--dsw-alias-label-primary);font-size:13px">${a.task_id}</span>
								<span style="font-size:12px;color:var(--dsw-alias-label-tertiary)">${a.stage}</span>
							</div>
							<div>${a.title}</div>
							<div style="font-size:12px;color:var(--dsw-alias-label-tertiary)">${t('dashboard.card.role')}: ${a.role}</div>
						</div>`;
					});
					content.innerHTML = html;
				} catch (err) {
					content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dsw-error)">${err.message}</div>`;
				}
			}

			async function loadAudit(container) {
				const content = container.querySelector('#control-content');
				if (!content) return;
				content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dsw-alias-label-tertiary)">${t('dashboard.status.loading')}</div>`;
				try {
					const res = await fetch(`${API_PREFIX}/audit`);
					const logs = await res.json();
					if (!logs.length) {
						content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dsw-alias-label-tertiary)">${t('dashboard.empty.audit')}</div>`;
						return;
					}
					let html = `<table style="width:100%;border-collapse:collapse;font-size:13px">
						<tr style="border-bottom:1px solid var(--dsw-alias-border-l2)">
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.id')}</th>
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.task')}</th>
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.action')}</th>
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.operator')}</th>
							<th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--dsw-alias-label-primary);font-size:11px;text-transform:uppercase">${t('dashboard.table.time')}</th>
						</tr>`;
					logs.forEach(l => {
						html += `<tr style="border-bottom:1px solid var(--dsw-alias-border-l2)">
							<td style="padding:8px 12px">${l.id}</td>
							<td style="padding:8px 12px">${l.task_id}</td>
							<td style="padding:8px 12px">${l.action}</td>
							<td style="padding:8px 12px">${l.operator}</td>
							<td style="padding:8px 12px">${new Date(l.created_at).toLocaleString()}</td>
						</tr>`;
					});
					html += '</table>';
					content.innerHTML = html;
				} catch (err) {
					content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--dsw-error)">${err.message}</div>`;
				}
			}

			function showControlView() {
				if (isControlActive) return;

				// 创建 controlView（如果不存在）
				if (!controlView) {
					controlView = document.createElement("div");
					controlView.dataset.controlView = "true";
					// 固定定位覆盖整个视口，但留出 sidebar 空间
					// 使用 !important 确保背景色覆盖，避免透明
					controlView.style.cssText = "position:fixed;top:0;left:var(--dsw-sidebar-width,260px);right:0;bottom:0;z-index:100;padding:16px;background-color:inherit;overflow:auto;";
					renderDashboard(controlView);
				}
				
				// 添加到 body
				document.body.appendChild(controlView);

				isControlActive = true;
				if (sidebarItem) {
					sidebarItem.style.background = "var(--dsw-alias-interactive-bg-hover)";
				}
			}

			function hideControlView() {
				if (!isControlActive) return;
				
				// 从 DOM 中移除 controlView
				if (controlView && controlView.parentElement) {
					controlView.remove();
				}
				
				isControlActive = false;
				if (sidebarItem) {
					sidebarItem.style.background = "transparent";
				}
			}

			function toggleControlView() {
				if (isControlActive) {
					hideControlView();
				} else {
					showControlView();
				}
			}

			function injectSidebar(region) {
				if (!region) return;
				if (sidebarItem && sidebarItem.isConnected) return;

				const item = document.createElement("button");
				item.dataset.controlSidebar = "true";
				item.style.cssText = "display:flex;align-items:center;gap:8px;width:calc(100% - 8px);margin:2px 4px;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;cursor:pointer;text-align:left;transition:background 0.15s;";
				item.addEventListener("mouseenter", () => {
					if (!isControlActive) item.style.background = "var(--dsw-alias-interactive-bg-hover)";
				});
				item.addEventListener("mouseleave", () => {
					if (!isControlActive) item.style.background = "transparent";
				});
				item.innerHTML = `<span style="opacity:.8">▤</span> ${t('sidebar.label')} <b data-control-sidebar-count style="margin-left:auto;opacity:.7;font-size:12px">–</b>`;
				item.title = t('sidebar.title');
				item.addEventListener("click", () => toggleControlView());
				region.insertBefore(item, region.firstChild);
				sidebarItem = item;
			}

			// ── 观察 DOM ─────────────────────────────────────────
			const observer = new MutationObserver(() => {
				const region = findSidebarRegion();
				if (region) injectSidebar(region);
			});
			observer.observe(document.documentElement, { childList: true, subtree: true });
			const r0 = findSidebarRegion();
			if (r0) injectSidebar(r0);
			refreshBadge();
			if (badgeTimer) clearInterval(badgeTimer);
			badgeTimer = setInterval(refreshBadge, 30000);

			// ── 监听 DSH locale 变化 ────────────────────────────
			const langObserver = new MutationObserver((mutations) => {
				for (const m of mutations) {
					if (m.attributeName === 'lang') {
						const newLang = document.documentElement.lang || '';
						console.log('[control-dsh-plugin] locale changed:', newLang);
						// 刷新页面以应用新语言
						if (isControlActive && controlView) {
							renderDashboard(controlView);
						}
						// 更新 sidebar 文本
						if (sidebarItem) {
							sidebarItem.querySelector('span:last-of-type')?.remove();
							const label = document.createElement('span');
							label.textContent = (newLang.startsWith('zh') ? zh : en)['sidebar.label'];
							sidebarItem.insertBefore(label, sidebarItem.querySelector('b'));
						}
					}
				}
			});
			langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

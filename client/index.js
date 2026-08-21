// control-dsh-plugin client 半区（浏览器端）v0.7：
//   sidebar 注入 "▤ Control" 导航项（点击 → centerCol 渲染 dashboard）
//   主题复用 DSH CSS 变量，i18n 支持 zh/en。
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

			// 检测语言：优先 DSH 全局 locale，其次浏览器
			const lang = (window.__DSH_LOCALE__ || navigator.language || 'zh').startsWith('zh') ? 'zh' : 'en';
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
			let originalView = null;
			let isControlActive = false;

			function findCenterCol() {
				const cols = document.querySelectorAll('[class*="_centerCol"]');
				for (const el of cols) {
					if (el.closest('[class*="_frame"]')) return el;
				}
				return null;
			}

			function showControlView() {
				const centerCol = findCenterCol();
				if (!centerCol) return;
				if (isControlActive) return;

				if (!originalView) {
					originalView = centerCol.firstElementChild;
				}
				if (originalView) {
					originalView.style.display = "none";
				}

				if (!controlView) {
					controlView = document.createElement("div");
					controlView.dataset.controlView = "true";
					// 复用 centerCol 的 flex 布局，只设置必要的填充样式
					controlView.style.cssText = "flex:1;min-width:0;overflow:hidden;display:flex;flex-direction:column;";

					// 内嵌 iframe 加载 dashboard（带 i18n 参数）
					const frame = document.createElement("iframe");
					frame.src = `/control/dashboard?lang=${lang}`;
					frame.style.cssText = "width:100%;height:100%;border:0;display:block;";
					frame.title = t('sidebar.title');
					controlView.appendChild(frame);
					centerCol.appendChild(controlView);
				} else {
					controlView.style.display = "flex";
					// 更新语言参数
					const frame = controlView.querySelector("iframe");
					if (frame) frame.src = `/control/dashboard?lang=${lang}`;
				}

				isControlActive = true;
				if (sidebarItem) {
					sidebarItem.style.background = "var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))";
				}
			}

			function hideControlView() {
				if (!isControlActive) return;
				if (controlView) {
					controlView.style.display = "none";
				}
				if (originalView) {
					originalView.style.display = "";
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
				// 完全复用 sidebar 项的样式，使用 DSH 变量
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
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

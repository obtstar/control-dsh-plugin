// control-dsh-plugin client 半区（浏览器端）v0.6：
//   sidebar 注入 "▤ Control" 导航项（点击 → centerCol 渲染 dashboard，替换对话视图）
// 不注入 header/tabs，不复写 CSS，直接复用 DSH 布局类名。
// 经 dsh-client-modules boot graph 加载。
window.__ModuleLoader__.load({
	id: "control-dsh-plugin",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;

		const name = "control-ui";
		const inject = [];

		function apply() {
			if (typeof document === "undefined") return;
			const API_PREFIX = "/control/dashboard/api";

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
				// 找到 centerCol（会话主体区域）
				const cols = document.querySelectorAll('[class*="_centerCol"]');
				for (const el of cols) {
					// 确保是 conversation 的 centerCol，不是其他
					if (el.closest('[class*="_frame"]')) return el;
				}
				return null;
			}

			function showControlView() {
				const centerCol = findCenterCol();
				if (!centerCol) return;

				// 如果已经激活，不重复操作
				if (isControlActive) return;

				// 保存原始视图（第一个子元素通常是会话内容）
				if (!originalView) {
					originalView = centerCol.firstElementChild;
				}

				// 隐藏原始视图
				if (originalView) {
					originalView.style.display = "none";
				}

				// 创建 Control 视图（复用 centerCol 的 flex 布局）
				if (!controlView) {
					controlView = document.createElement("div");
					controlView.dataset.controlView = "true";
					// 不设置任何样式，让父级 centerCol 的 flex 布局控制
					// centerCol 已经是 display:flex; flex-direction:column; overflow:hidden;
					controlView.style.cssText = "flex:1;min-width:0;overflow:auto;";

					// 内嵌 iframe 加载 dashboard
					const frame = document.createElement("iframe");
					frame.src = "/control/dashboard";
					frame.style.cssText = "width:100%;height:100%;border:0;display:block;";
					controlView.appendChild(frame);
					centerCol.appendChild(controlView);
				} else {
					controlView.style.display = "block";
				}

				isControlActive = true;

				// 高亮 sidebar 按钮
				if (sidebarItem) {
					sidebarItem.style.background = "var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))";
				}
			}

			function hideControlView() {
				if (!isControlActive) return;

				// 隐藏 Control 视图
				if (controlView) {
					controlView.style.display = "none";
				}

				// 恢复原始视图
				if (originalView) {
					originalView.style.display = "";
				}

				isControlActive = false;

				// 取消高亮 sidebar 按钮
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
				// 样式与 sidebar 其他项一致，使用 DSH 变量
				item.style.cssText = "display:flex;align-items:center;gap:8px;width:calc(100% - 8px);margin:2px 4px;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;cursor:pointer;text-align:left;transition:background 0.15s;";
				item.addEventListener("mouseenter", () => {
					if (!isControlActive) item.style.background = "var(--dsw-alias-interactive-bg-hover)";
				});
				item.addEventListener("mouseleave", () => {
					if (!isControlActive) item.style.background = "transparent";
				});
				item.innerHTML = '<span style="opacity:.8">▤</span> Control <b data-control-sidebar-count style="margin-left:auto;opacity:.7;font-size:12px">–</b>';
				item.title = "control 任务看板";
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

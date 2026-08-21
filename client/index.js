// control-dsh-plugin client 半区（浏览器端）：
//   1) 会话页 header 注入 control 待审批徽标（点击跳看板）
//   2) sidebar 注入 "Control" 导航项（点击 → 主区全屏内嵌看板视图，近似"对话/轨迹"形态）
// 经 dsh-client-modules boot graph 加载；纯 DOM 注入，CSS module 按 `<hash>_<name>` 后缀定位。
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
			function findHeader() {
				const candidates = document.querySelectorAll('[class$="_header"]');
				for (const el of candidates) {
					if (el.querySelector('[class$="_titleRow"]') || el.querySelector('[class$="_headerActions"]')) return el;
				}
				return null;
			}
			function findSidebarRegion() {
				// sidebar 主区域（workspaces 列表容器）；footer 区域不要
				const areas = document.querySelectorAll('[class$="_regionArea"]');
				for (const el of areas) {
					if (el.querySelector('[class$="_newSession"]') || el.querySelector('[class$="_settingsArea"]')) continue;
					return el;
				}
				return null;
			}
			async function fetchCount() {
				try {
					const res = await fetch(`${API_PREFIX}/approvals/pending`, { cache: "no-store" });
					if (!res.ok) return null;
					const rows = await res.json();
					return Array.isArray(rows) ? rows.length : 0;
				} catch { return null; }
			}

			// ── 1) header 徽标 ───────────────────────────────────
			let headerBadge = null;
			let sidebarItem = null;
			let badgeTimer = null;

			async function refreshBadge() {
				const count = await fetchCount();
				const text = count === null ? "–" : String(count);
				if (headerBadge) {
					headerBadge.querySelector("[data-control-count]").textContent = text;
					headerBadge.title = count === null ? "control 不可达" : `control 待审批 ${count} 项`;
				}
				if (sidebarItem) {
					const badge = sidebarItem.querySelector("[data-control-sidebar-count]");
					if (badge) badge.textContent = text;
				}
			}
			function injectHeader(header) {
				if (!header) return;
				if (headerBadge && headerBadge.isConnected) return;
				const div = document.createElement("div");
				div.dataset.controlHeader = "true";
				div.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin:0 10px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2,#30363d);border-radius:12px;font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer;white-space:nowrap;";
				div.innerHTML = "control <b data-control-count style=\"color:var(--dsw-alias-label-primary,#f0f6fc)\">–</b>";
				div.title = "control 待审批数；点击打开看板";
				div.addEventListener("click", () => openDashboard());
				const titleRow = header.querySelector('[class$="_titleRow"]');
				if (titleRow && titleRow.nextSibling) header.insertBefore(div, titleRow.nextSibling);
				else header.appendChild(div);
				headerBadge = div;
			}

			// ── 2) sidebar 导航项 + 全屏视图 ─────────────────────
			let overlay = null;

			function openDashboard() {
				if (overlay && overlay.isConnected) return;
				overlay = document.createElement("div");
				overlay.dataset.controlOverlay = "true";
				overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:var(--dsw-alias-app-bg,#0d1117);display:flex;flex-direction:column;";
				const bar = document.createElement("div");
				bar.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#30363d);flex:none;";
				const title = document.createElement("span");
				title.textContent = "control 看板";
				title.style.cssText = "flex:1;font-weight:600;color:var(--dsw-alias-label-primary,#f0f6fc);";
				const close = document.createElement("button");
				close.textContent = "关闭";
				close.style.cssText = "cursor:pointer;padding:4px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#30363d);background:var(--dsw-alias-button-elevated-fill,#21262d);color:var(--dsw-alias-label-primary,#f0f6fc);";
				close.addEventListener("click", () => { overlay.remove(); overlay = null; });
				const frame = document.createElement("iframe");
				frame.src = "/control/dashboard";
				frame.style.cssText = "flex:1;border:0;width:100%;";
				bar.appendChild(title);
				bar.appendChild(close);
				overlay.appendChild(bar);
				overlay.appendChild(frame);
				document.body.appendChild(overlay);
			}

			function injectSidebar(region) {
				if (!region) return;
				if (sidebarItem && sidebarItem.isConnected) return;
				const item = document.createElement("button");
				item.dataset.controlSidebar = "true";
				item.style.cssText = "display:flex;align-items:center;gap:8px;width:calc(100% - 8px);margin:2px 4px;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#f0f6fc);font-size:14px;cursor:pointer;text-align:left;";
				item.addEventListener("mouseenter", () => { item.style.background = "var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))"; });
				item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
				item.innerHTML = "<span style=\"opacity:.8\">▤</span> Control <b data-control-sidebar-count style=\"margin-left:auto;opacity:.7;font-size:12px\">–</b>";
				item.title = "control 任务看板（待审批数）";
				item.addEventListener("click", () => openDashboard());
				region.insertBefore(item, region.firstChild);
				sidebarItem = item;
			}

			// ── 观察 DOM（SPA 路由/侧栏切换会重建）──────────────
			const observer = new MutationObserver(() => {
				const header = findHeader();
				if (header) injectHeader(header);
				const region = findSidebarRegion();
				if (region) injectSidebar(region);
			});
			observer.observe(document.documentElement, { childList: true, subtree: true });
			const h0 = findHeader();
			if (h0) injectHeader(h0);
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

// control-dsh-plugin client 半区（浏览器端）v0.5：
//   1) 会话页 header 注入 control 待审批徽标
//   2) 将会话区域的 "conversation.view" 注入 Control 标签页（与 Chat/Trajectory 并列）
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

			// ── 1) header 徽标 ───────────────────────────────────
			let headerBadge = null;
			let badgeTimer = null;

			async function refreshBadge() {
				const count = await fetchCount();
				const text = count === null ? "–" : String(count);
				if (headerBadge) {
					headerBadge.querySelector("[data-control-count]").textContent = text;
					headerBadge.title = count === null ? "control 不可达" : `control 待审批 ${count} 项`;
				}
			}

			function findHeader() {
				const candidates = document.querySelectorAll('[class$="_header"]');
				for (const el of candidates) {
					if (el.querySelector('[class$="_titleRow"]') || el.querySelector('[class$="_headerActions"]')) return el;
				}
				return null;
			}

			function injectHeader(header) {
				if (!header) return;
				if (headerBadge && headerBadge.isConnected) return;
				const div = document.createElement("div");
				div.dataset.controlHeader = "true";
				div.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin:0 10px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2,#30363d);border-radius:12px;font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer;white-space:nowrap;";
				div.innerHTML = "control <b data-control-count style=\"color:var(--dsw-alias-label-primary,#f0f6fc)\">–</b>";
				div.title = "control 待审批数；点击打开看板";
				div.addEventListener("click", () => switchToControlTab());
				const titleRow = header.querySelector('[class$="_titleRow"]');
				if (titleRow && titleRow.nextSibling) header.insertBefore(div, titleRow.nextSibling);
				else header.appendChild(div);
				headerBadge = div;
			}

			// ── 2) 注入 conversation.view 标签页 ─────────────────
			// 找到 conversation 区域的标签栏，注入 "Control" 标签
			function findConversationTabBar() {
				// 标签栏通常在 conversation 区域内，包含 Chat/Trajectory 等按钮
				const tabs = document.querySelectorAll('[class*="_tab"], [role="tablist"]');
				for (const el of tabs) {
					// 检查是否包含 Chat 或 Trajectory 文本
					if (el.textContent.includes("Chat") || el.textContent.includes("Trajectory") || el.textContent.includes("对话") || el.textContent.includes("轨迹")) {
						return el;
					}
				}
				return null;
			}

			function findConversationBody() {
				// 找到 conversation 内容区域（标签页内容容器）
				const bodies = document.querySelectorAll('[class*="_centerCol"], [class*="_sessionBody"]');
				for (const el of bodies) {
					if (el.children.length > 0) return el;
				}
				return null;
			}

			let controlTab = null;
			let controlPanel = null;
			let activeTabId = null;

			function switchToControlTab() {
				// 隐藏其他标签页内容，显示 Control
				if (controlPanel) {
					controlPanel.style.display = "block";
					// 尝试隐藏其他视图
					const siblings = controlPanel.parentElement?.children;
					if (siblings) {
						for (const sib of siblings) {
							if (sib !== controlPanel && sib.tagName !== "STYLE") {
								sib.style.display = "none";
							}
						}
					}
				}
				// 更新标签样式
				if (controlTab) {
					controlTab.style.background = "var(--dsw-accent,#1f6feb)";
					controlTab.style.color = "white";
					controlTab.style.borderColor = "var(--dsw-accent,#1f6feb)";
				}
				// 重置其他标签
				const tabBar = controlTab?.parentElement;
				if (tabBar) {
					for (const tab of tabBar.children) {
						if (tab !== controlTab && tab.dataset?.controlTab !== "true") {
							tab.style.background = "";
							tab.style.color = "";
							tab.style.borderColor = "";
						}
					}
				}
			}

			function injectControlTab(tabBar) {
				if (!tabBar) return;
				if (controlTab && controlTab.isConnected) return;

				// 创建 Control 标签按钮
				const tab = document.createElement("button");
				tab.dataset.controlTab = "true";
				tab.textContent = "Control";
				// 复制现有标签的样式
				const existingTab = tabBar.querySelector("button, [role='tab']");
				if (existingTab) {
					tab.style.cssText = window.getComputedStyle(existingTab).cssText;
				} else {
					tab.style.cssText = "padding:6px 14px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer;font-size:13px;transition:all 0.15s;";
				}
				tab.addEventListener("mouseenter", () => {
					if (tab.style.borderBottomColor !== "var(--dsw-accent, rgb(31, 111, 251))") {
						tab.style.borderBottomColor = "var(--dsw-alias-border-l2,#30363d)";
					}
				});
				tab.addEventListener("mouseleave", () => {
					if (tab.style.borderBottomColor !== "var(--dsw-accent, rgb(31, 111, 251))") {
						tab.style.borderBottomColor = "transparent";
					}
				});
				tab.addEventListener("click", () => switchToControlTab());
				tabBar.appendChild(tab);
				controlTab = tab;

				// 创建 Control 面板（iframe 内嵌）
				const body = findConversationBody();
				if (body) {
					const panel = document.createElement("div");
					panel.dataset.controlPanel = "true";
					panel.style.cssText = "display:none;height:100%;width:100%;";
					const frame = document.createElement("iframe");
					frame.src = "/control/dashboard";
					frame.style.cssText = "width:100%;height:100%;border:0;";
					panel.appendChild(frame);
					body.appendChild(panel);
					controlPanel = panel;
				}
			}

			// ── 观察 DOM ─────────────────────────────────────────
			const observer = new MutationObserver(() => {
				const header = findHeader();
				if (header) injectHeader(header);
				const tabBar = findConversationTabBar();
				if (tabBar) injectControlTab(tabBar);
			});
			observer.observe(document.documentElement, { childList: true, subtree: true });
			const h0 = findHeader();
			if (h0) injectHeader(h0);
			const t0 = findConversationTabBar();
			if (t0) injectControlTab(t0);
			refreshBadge();
			if (badgeTimer) clearInterval(badgeTimer);
			badgeTimer = setInterval(refreshBadge, 30000);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

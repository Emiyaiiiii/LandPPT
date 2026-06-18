        async function exportSlidesToPptxClient(options = {}) {
            console.log('[Export] Starting client export (file version)');
            if (isClientExporting) {
                console.log('[Export] Already exporting, returning');
                return;
            }
            if (!slidesData || slidesData.length === 0) {
                showNotification('没有可导出的幻灯片', 'warning');
                return;
            }

            const normalizedOptions = (options && typeof options === 'object') ? options : {};
            const parsedSlideIndices = Array.isArray(normalizedOptions.slideIndices)
                ? normalizedOptions.slideIndices
                    .map(idx => Number.parseInt(idx, 10))
                    .filter(idx => Number.isInteger(idx) && idx >= 0)
                : null;
            const requestedSlideIndices = parsedSlideIndices && parsedSlideIndices.length > 0
                ? parsedSlideIndices
                : null;
            const singleSlideMode = requestedSlideIndices && requestedSlideIndices.length === 1;

            let exporter = null;
            try {
                console.log('[Export] Loading dom-to-pptx library...');
                exporter = await ensureDomToPptxReadyForExport();
                console.log('[Export] dom-to-pptx library loaded');
            } catch (e) {
                console.error('[Export] Failed to load dom-to-pptx:', e);
                showNotification((e && e.message) || 'PPTX 导出库未加载，请检查网络连接后刷新页面重试。', 'error');
                return;
            }

            if (!exporter || typeof exporter.exportToPptx !== 'function') {
                showNotification('PPTX 导出库未加载，请检查网络连接后刷新页面重试。', 'error');
                return;
            }

            isClientExporting = true;
            clientExportCancelRequested = false;
            clientExportAbortController = createClientExportAbortController();
            const exportSignal = clientExportAbortController.signal;

            console.log('[Export] Showing export overlay...');
            updateExportUI(
                'cog',
                'spinning',
                singleSlideMode ? '正在导出单页 PPTX' : '正在导出 PPTX',
                singleSlideMode ? '请稍候，正在将当前页转换为 PowerPoint 文件...' : '请稍候，正在将幻灯片转换为 PowerPoint 文件...',
                0,
                '准备中...'
            );
            showExportOverlay();
            updateExportCancelButton(true, false, '取消导出');

            const filteredSlides = slidesData
                .map((slide, originalIndex) => ({ slide, originalIndex }))
                .filter(item => !requestedSlideIndices || requestedSlideIndices.includes(item.originalIndex))
                .filter(item => item.slide && item.slide.html_content)
                .sort((a, b) => (a.slide.page_number || 0) - (b.slide.page_number || 0));

            if (filteredSlides.length === 0) {
                hideExportOverlay();
                updateExportCancelButton(false);
                showNotification(singleSlideMode ? '当前页内容为空，无法导出' : '幻灯片内容为空，无法导出', 'warning');
                isClientExporting = false;
                clientExportAbortController = null;
                return;
            }

            const sortedSlides = filteredSlides;
            const totalSlides = sortedSlides.length;
            const useDirectDomSource = true;
            const renderHost = document.createElement('div');
            renderHost.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;z-index:-1;';
            document.body.appendChild(renderHost);

            try {
                throwIfClientExportCancelled(exportSignal);
                // Load latest icon rules JSON before export (supports online hot-update).
                updateExportUI(null, null, null, '加载图标导出规则...', 3, '准备中...');
                console.log('[Export] About to call refreshIconExportRules...');
                try {
                    await refreshIconExportRules(true);
                    console.log('[Export] refreshIconExportRules completed successfully');
                } catch (iconErr) {
                    console.error('[Export] refreshIconExportRules failed:', iconErr);
                }
                throwIfClientExportCancelled(exportSignal);
                console.log('[Export] Getting icon rules...');
                const iconRulesForExport = getCompiledIconExportRules().rawRules;
                console.log('[Export] Icon rules ready, setting to exporter...');
                if (typeof exporter.setIconRules === 'function') {
                    exporter.setIconRules(iconRulesForExport);
                }
                console.log('[Export] Icon rules set, loading speech scripts...');

                // Best-effort: load speech scripts and attach to PPTX speaker notes.
                let slideNotes = [];
                try {
                    const preferredLang = String(currentSpeechLanguage || 'zh').toLowerCase();
                    let scripts = [];

                    if (speechScriptData && speechScriptData.scripts && speechScriptData.scripts.length > 0) {
                        const dataLang = String((speechScriptData.scripts[0] && speechScriptData.scripts[0].language) || preferredLang).toLowerCase();
                        if (dataLang === preferredLang) {
                            scripts = speechScriptData.scripts;
                        }
                    }

                    const fetchScripts = async (lang) => {
                        try {
                            console.log('[Export] Fetching speech scripts for language:', lang);
                            const resp = await fetch(`/api/projects/${window.landpptEditorConfig.projectId}/speech-scripts?language=${encodeURIComponent(lang)}`, {
                                credentials: 'same-origin'
                            });
                            console.log('[Export] Speech scripts fetch response status:', resp.status);
                            const result = await resp.json().catch(() => ({}));
                            console.log('[Export] Speech scripts fetch result:', JSON.stringify(result).substring(0, 200));
                            if (resp.ok && result && result.success && Array.isArray(result.scripts)) {
                                return result.scripts;
                            }
                            return [];
                        } catch (err) {
                            console.error('[Export] Speech scripts fetch error:', err);
                            return [];
                        }
                    };

                    if (!scripts.length) {
                        const langsToTry = [];
                        if (preferredLang) langsToTry.push(preferredLang);
                        if (!langsToTry.includes('zh')) langsToTry.push('zh');
                        if (!langsToTry.includes('en')) langsToTry.push('en');
                        for (const lang of langsToTry) {
                            throwIfClientExportCancelled(exportSignal);
                            scripts = await fetchScripts(lang);
                            throwIfClientExportCancelled(exportSignal);
                            if (scripts.length) break;
                        }
                    }

                    if (scripts && scripts.length) {
                        const notesByIndex = new Map();
                        scripts.forEach((script) => {
                            const idx = Number.isInteger(script.slide_index) ? script.slide_index : parseInt(script.slide_index, 10);
                            if (!Number.isInteger(idx) || idx < 0) return;
                            const text = (script.script_content || script.speaker_notes || '').toString();
                            if (text && text.trim()) notesByIndex.set(idx, text);
                        });

                        slideNotes = sortedSlides.map((it) => {
                            const t = notesByIndex.get(it.originalIndex);
                            return t ? String(t).trim() : '';
                        });
                    } else {
                        console.log('[Export] No speech scripts found, continuing without notes');
                    }
                } catch (e) {
                    console.warn('Failed to load speech scripts for PPTX notes:', e);
                    slideNotes = [];
                }

                console.log('[Export] Creating render iframe...');
                // Use a single reusable iframe renderer to keep memory stable on large decks.
                const renderIframe = document.createElement('iframe');
                renderIframe.style.cssText = 'width:1280px;height:720px;border:none;position:absolute;left:0;top:0;';
                renderIframe.setAttribute('aria-hidden', 'true');
                renderIframe.tabIndex = -1;
                renderHost.appendChild(renderIframe);

                updateExportUI(null, null, null, '准备渲染导出内容（低内存DOM模式）...', 8, '准备中...');

                console.log('[Export] Starting slide element stream, totalSlides:', totalSlides);
                const slideElementStream = (async function* () {
                    for (let i = 0; i < totalSlides; i++) {
                        console.log('[Export] Processing slide', i + 1, 'of', totalSlides);
                        throwIfClientExportCancelled(exportSignal);
                        const item = sortedSlides[i];
                        const slide = item.slide;
                        const pct = Math.round(10 + ((i) / totalSlides) * 80);
                        updateExportUI(null, null, null, null, pct, '正在处理第 ' + (i + 1) + '/' + totalSlides + ' 页: ' + (slide.title || '幻灯片'));

                        let sourceDoc = null;
                        let tempIframe = null;
                        let container = null;
                        try {
                            console.log('[Export] Calling ensureIframeHasLatestContent for slide', i + 1);
                            const ok = await ensureIframeHasLatestContent(renderIframe, slide.html_content, {
                                forceRefresh: true,
                                loadTimeoutMs: 7000,
                                visualTimeoutMs: 5200,
                                imageTimeoutMs: 4200,
                                animationSettleCapMs: 6500
                            });
                            console.log('[Export] ensureIframeHasLatestContent returned:', ok);
                            throwIfClientExportCancelled(exportSignal);

                            if (ok) {
                                sourceDoc = renderIframe.contentDocument || renderIframe.contentWindow.document;
                            }

                            // Fallback: create a temporary iframe for this slide only.
                            if (!sourceDoc || !sourceDoc.body) {
                                tempIframe = document.createElement('iframe');
                                tempIframe.style.cssText = renderIframe.style.cssText;
                                tempIframe.setAttribute('sandbox', 'allow-modals');
                                renderHost.appendChild(tempIframe);
                                await loadSlideIntoTempIframe(tempIframe, slide.html_content);
                                throwIfClientExportCancelled(exportSignal);
                                sourceDoc = tempIframe.contentDocument || tempIframe.contentWindow.document;
                            }

                            if (!sourceDoc || !sourceDoc.body) {
                                throw new Error('无法提取第 ' + (i + 1) + ' 页渲染内容');
                            }

                            if (useDirectDomSource) {
                                await waitForDocumentFontsReady(sourceDoc, 1400);
                                await waitForDocumentImagesReady(sourceDoc, 3200);
                                await waitForFormulaRenderReady(sourceDoc, 2400);
                                await waitForCanvasPaintReady(sourceDoc, 2600);
                                throwIfClientExportCancelled(exportSignal);
                                settleCssAnimationsToFinalState(sourceDoc);
                                await waitForAnimationFrames(sourceDoc.defaultView || window, 1);
                                throwIfClientExportCancelled(exportSignal);
                                tagFormulaNodesForExport(sourceDoc.body || sourceDoc);
                                yield sourceDoc.body;
                                continue;
                            }

                            container = document.createElement('div');
                            container.style.cssText = 'width:1280px;height:720px;overflow:hidden;position:relative;background:white;';
                            renderHost.appendChild(container);

                            const built = buildExportContainerFromDocument(sourceDoc, container);
                            if (!built) {
                                throw new Error('无法提取第 ' + (i + 1) + ' 页渲染内容');
                            }

                            await waitForStylesheetsReadyInContainer(container, 2600);
                            await waitForDocumentFontsReady(document, 1800);
                            await waitForImagesReadyInContainer(container, 2800);
                            throwIfClientExportCancelled(exportSignal);

                            // Convert oklch/oklab/lch/lab/color() to hex for dom-to-pptx compatibility
                            convertModernColors(container);
                            yield container;
                        } finally {
                            if (tempIframe && tempIframe.parentNode) {
                                tempIframe.parentNode.removeChild(tempIframe);
                            }
                            if (container && container.parentNode) {
                                container.parentNode.removeChild(container);
                            }
                        }
                    }
                    updateExportUI(null, null, null, null, 94, '正在生成 PPTX 文件...');
                })();

                const projectTitleRaw = window.landpptEditorConfig.exportTitle || 'presentation';
                const projectTitle = String(projectTitleRaw || '').replace(/[\\/:*?"<>|]/g, '_').trim();
                let fileBaseName = projectTitle || 'presentation';
                if (singleSlideMode && sortedSlides[0] && sortedSlides[0].slide) {
                    const targetSlide = sortedSlides[0].slide;
                    const pageNumber = Number.parseInt(targetSlide.page_number, 10);
                    const pageLabel = Number.isInteger(pageNumber) && pageNumber > 0 ? `-P${pageNumber}` : '';
                    const titleLabel = String(targetSlide.title || '')
                        .replace(/[\\/:*?"<>|]/g, '_')
                        .trim();
                    fileBaseName = `${fileBaseName}${pageLabel}${titleLabel ? '-' + titleLabel : ''}`;
                }
                const fileName = `${fileBaseName}.pptx`;

                throwIfClientExportCancelled(exportSignal);
                console.log('[Export] About to call exporter.exportToPptx, fileName:', fileName);
                const result = await exporter.exportToPptx(slideElementStream, {
                    fileName: fileName,
                    autoEmbedFonts: true,
                    svgAsVector: false,
                    slideNotes: slideNotes,
                    iconRules: getCompiledIconExportRules().rawRules,
                    signal: exportSignal,
                    shouldCancel: () => !!(clientExportCancelRequested || (exportSignal && exportSignal.aborted))
                });
                console.log('[Export] exporter.exportToPptx completed successfully, result:', typeof result);

                // Only trigger manual download if in iframe (where native download may not work)
                // In normal browser window, exportToPptx handles download internally
                const isInIframe = window !== window.top;
                console.log('[Export] isInIframe:', isInIframe, '(window === window.top:', window === window.top, ')');
                
                if (isInIframe && result && (result.blob || result.url || result instanceof Blob)) {
                    console.log('[Export] In iframe, manually triggering download');
                    const blob = result.blob || result;
                    console.log('[Export] Blob type:', blob.type, 'Blob size:', blob.size);
                    
                    // Create blob URL
                    const blobUrl = URL.createObjectURL(blob);
                    console.log('[Export] Blob URL created:', blobUrl.substring(0, 50) + '...');
                    
                    // Try to navigate top window to blob URL
                    console.log('[Export] Attempting window.top.location.href = blobUrl');
                    console.log('[Export] About to call setTimeout');
                    try {
                        // Use setTimeout to ensure async execution
                        const timerId = setTimeout(function timeoutCallback() {
                            console.log('[Export] setTimeout callback EXECUTED');
                            console.log('[Export] Inside setTimeout, checking window.top:', !!window.top);
                            console.log('[Export] window.top.location exists:', !!(window.top && window.top.location));
                            
                            if (window.top && window.top.location) {
                                // Create a link with download attribute
                                const a = document.createElement('a');
                                a.href = blobUrl;
                                a.download = fileName;
                                a.target = '_top';
                                a.style.display = 'none';
                                document.body.appendChild(a);
                                console.log('[Export] Download link created, triggering click');
                                a.click();
                                document.body.removeChild(a);
                                console.log('[Export] Click triggered');
                            } else {
                                console.log('[Export] window.top.location not available, using fallback');
                                // Fallback: try window.open
                                const opened = window.open(blobUrl, '_top');
                                console.log('[Export] window.open result:', opened ? 'opened' : 'null/blocked');
                            }
                        }, 0);
                        console.log('[Export] setTimeout called, timerId:', timerId);
                    } catch (e) {
                        console.error('[Export] setTimeout download failed:', e);
                    }
                } else {
                    console.log('[Export] In normal browser window, exportToPptx handles download internally');
                }

                hideExportOverlay();
                updateExportCancelButton(false);

            } catch (err) {
                console.error('[Export] Export error caught:', err);
                if (isClientExportAbortError(err)) {
                    hideExportOverlay();
                    updateExportCancelButton(false);
                    showNotification('已取消客户端导出', 'info');
                    return;
                }
                console.error('PPTX client export failed:', err);
                updateExportCancelButton(false);
                updateExportUI('exclamation-circle', 'error', '导出失败', err.message || '未知错误，请重试', 0, '请关闭此窗口后重试');

                const overlay = document.getElementById('exportOverlay');
                if (overlay) {
                    overlay.addEventListener('click', function handler(e) {
                        if (e.target === overlay) {
                            hideExportOverlay();
                            overlay.removeEventListener('click', handler);
                        }
                    });
                }
            } finally {
                if (renderHost.parentNode) {
                    renderHost.parentNode.removeChild(renderHost);
                }
                isClientExporting = false;
                clientExportCancelRequested = false;
                clientExportAbortController = null;
            }
        }

        async function exportSingleSlidePptxClient() {
            hideContextMenu();
            if (!Number.isInteger(contextMenuSlideIndex) || contextMenuSlideIndex < 0 || contextMenuSlideIndex >= slidesData.length) {
                showNotification('未找到可导出的幻灯片', 'warning');
                return;
            }
            await exportSlidesToPptxClient({ slideIndices: [contextMenuSlideIndex] });
        }

// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.core')

/**
 * Directive to display a rich text editor if enabled.
 *
 * @module mm.core
 * @ngdoc directive
 * @name mmRichTextEditor
 * @description
 * If enabled, this directive will show a rich text editor. Otherwise it'll show a regular textarea.
 *
 * This directive requires an OBJECT model. The text written in the editor or textarea will be stored inside
 * a "text" property in that object. This is to ensure 2-way data-binding, since using a string as a model
 * could be easily broken.
 *
 * Example:
 * <mm-rich-text-editor model="newpost" placeholder="{{ 'mma.mod_forum.message' | translate }}" scroll-handle="mmaScrollHandle">
 * </mm-rich-text-editor>
 *
 * In the example above, the text written in the editor will be stored in newpost.text.
 *
 * Accepts the following attributes:
 *
 * @param {Object} model           Model where to store the text. It'll be placed in model[property].
 * @param {Object} [property=text] Name of the model property where to store the text. Defaults to "text".
 * @param {String} [placeholder]   Placeholder to set in textarea if rich text editor is disabled.
 * @param {Object} [options]       Options to pass to the editor. It can be used to override default options.
 * @param {Object} [tabletOptions] Options to pass to the editor when run in a tablet. Has priority over "options" param.
 * @param {Object} [phoneOptions]  Options to pass to the editor when run in a phone. Has priority over "options" param.
 * @param {String} [scrollHandle]  Name of the scroll handle of the page containing the editor, to scroll to editor when focused.
 * @param {String} [name]          Name to set to the hidden textarea.
 * @param {Function} [textChange]  Function to call when the editor text changes.
 * @param {Function} [firstRender] Function to call when the editor text is first rendered. Only called with rich text editor.
 * @param {String} [component]     The component to link the files to.
 * @param {Mixed} [componentId]    An ID to use in conjunction with the component.
 * @param {Boolean} [required]     Whether the input is required.
 */
.directive('mmRichTextEditor', function($ionicPlatform, $mmLang, $timeout, $q, $window, $ionicScrollDelegate, $mmUtil,
            $mmSite, $mmFilepool) {

    var editorInitialHeightDefault = 300,
        adjustHeightDefault = true,
        frameTags = ['iframe', 'frame', 'object', 'embed'];

    /**
     * Calculate the height of fixed bars (like top bar).
     *
     * @param  {Object} editorEl Editor DOM element.
     * @return {Number}          Size of the fixed bars, 0 if not found.
     */
    function calculateFixedBarsHeight(editorEl) {
        var ionContentEl = editorEl.parentElement;
        while (ionContentEl && ionContentEl.nodeName != 'ION-CONTENT') {
            ionContentEl = ionContentEl.parentElement;
        }

        if (ionContentEl.nodeName == 'ION-CONTENT') {
            return $window.innerHeight - $mmUtil.getElementHeight(ionContentEl);
        } else {
            return 0;
        }
    }

    /**
     * Converts language code from "aa-bb" to "aa_BB".
     *
     * @param  {String} lang Language code.
     * @return {String}      Converted language code.
     */
    function changeLanguageCode(lang) {
        var split = lang.split('-');
        if (split.length > 1) {
            // Language has a dash. Convert it to underscore and uppercase second part.
            split[1] = split[1].toUpperCase();
            return split.join('_');
        } else {
            return lang;
        }
    }

    /**
     * Get CKEditor controller.
     *
     * @param  {Object} element Directive element.
     * @return {Object}         Controller (or undefined if not found).
     */
    function getCKEditorController(element) {
        var ckeditorEl = element.querySelector('textarea[ckeditor]');
        if (ckeditorEl) {
            return angular.element(ckeditorEl).controller('ckeditor');
        }
    }

    /**
     * Get the height of the surrounding elements from the current to the top element.
     *
     * @param  {Object} element Directive DOM element to get surroundings elements from.
     * @param  {Object} top     Top DOM element to stop getting elements.
     * @return {Number}         Surrounding height in px.
     */
    function getSurroundingHeight(element, top) {
        var height = 0;

        while (element.parentNode && element.parentNode.tagName != "ION-CONTENT" && (!top || element != top)) {
            var parent = element.parentNode;
            angular.forEach(parent.childNodes, function(child) {
                if (child.tagName && element.tagName && element.tagName != 'MM-LOADING' && child != element) {
                    height += $mmUtil.getElementHeight(child, false, true, true);
                }
            });
            element = parent;
        }
        var cs = getComputedStyle(element);
        height += (parseInt(cs.paddingTop, 10) + parseInt(cs.paddingBottom, 10));

        return height;
    }

    /**
     * Search WYSIWYG iframe and format its contents.
     *
     * @param  {Object} element      Directive DOM element.
     * @param  {String} [component]  The component to link the files to.
     * @param  {Mixed} [componentId] An ID to use in conjunction with the component.
     * @param  {Number} [tries]      Number of retries done until now.
     * @return {Promise}             Promise resolved with the WYSIWYG iframe or undefined if not found.
     */
    function searchAndFormatWysiwyg(element, component, componentId, tries) {
        if (typeof tries == 'undefined') {
            tries = 0;
        }

        var wysiwygIframe = element.querySelector('.cke_wysiwyg_frame');
        if (wysiwygIframe) {
            treatFrame(wysiwygIframe, component, componentId);
            return $q.when(wysiwygIframe);
        } else if (tries < 5) {
            return $timeout(function() {
                return searchAndFormatWysiwyg(element, component, componentId, tries+1);
            }, 100);
        }
    }

    /**
     * Treats a frame (iframe, object, ...), doing the following to it and all its sub frames:
     * Search links (<a>) and open them in browser.
     * Searches images and media and fixes their URLs.
     *
     * @param  {DOMElement} element  Element to treat.
     * @param  {String} [component]  The component to link the files to.
     * @param  {Mixed} [componentId] An ID to use in conjunction with the component.
     * @return {Void}
     */
    function treatFrame(element, component, componentId) {
        if (element) {
            var loaded = false;

            // Make sure it's a jqLite element.
            element = angular.element(element);

            element.on('load', function() {
                if (!loaded) {
                    // Element loaded, treat external content and subframes.
                    loaded = true;
                    treatExternalContent(element, component, componentId);
                    treatSubframes(element, component, componentId);
                }
            });

            // If iframe isn't loaded in 1 second we'll treat inner elements anyway.
            $timeout(function() {
                if (!loaded) {
                    loaded = true;
                    treatExternalContent(element, component, componentId);
                    treatSubframes(element, component, componentId);
                }
            }, 1000);
        }
    }

    /**
     * Redefine the open method in the contentWindow of an element and the sub frames.
     *
     * @param  {DOMElement} element  Element to treat.
     * @param  {String} [component]  The component to link the files to.
     * @param  {Mixed} [componentId] An ID to use in conjunction with the component.
     * @return {Void}
     */
    function treatSubframes(element, component, componentId) {
        var el = element[0],
            contentWindow = element.contentWindow || el.contentWindow,
            contents = element.contents();

        if (!contentWindow && el && el.contentDocument) {
            // It's probably an <object>. Try to get the window.
            contentWindow = el.contentDocument.defaultView;
        }

        if (!contentWindow && el && el.getSVGDocument) {
            // It's probably an <embed>. Try to get the window.
            var svgDoc = el.getSVGDocument();
            if (svgDoc && svgDoc.defaultView) {
                contents = angular.element(svgdoc);
            }
        }

        // Search sub frames.
        angular.forEach(frameTags, function(tag) {
            angular.forEach(contents.find(tag), function(subelement) {
                treatFrame(angular.element(subelement), component, componentId);
            });
        });
    }

    /**
     * Treat elements that can contain external content.
     * We only search for images because the editor should receive unfiltered text, so the multimedia filter won't be applied.
     * Treating videos and audios in here is complex, so if a user manually adds one he won't be able to play it in the editor.
     *
     * @param  {DOMElement} element  Element to treat.
     * @param  {String} [component]  The component to link the files to.
     * @param  {Mixed} [componentId] An ID to use in conjunction with the component.
     * @return {Void}
     */
    function treatExternalContent(element, component, componentId) {
        var elements = element.contents().find('img');
        angular.forEach(elements, function(el) {
            var url = el.src,
                siteId = $mmSite.getId();

            if (!url || !$mmUtil.isDownloadableUrl(url) || (!$mmSite.canDownloadFiles() && $mmUtil.isPluginFileUrl(url))) {
                // Nothing to treat.
                return;
            }

            // Check if it's downloaded.
            return $mmFilepool.getSrcByUrl(siteId, url, component, componentId).then(function(finalUrl) {
                el.setAttribute('src', finalUrl);
            });
        });
    }

    return {
        restrict: 'E',
        templateUrl: 'core/templates/richtexteditor.html',
        scope: {
            model: '=',
            property: '@?',
            placeholder: '@?',
            options: '=?',
            tabletOptions: '=?',
            phoneOptions: '=?',
            scrollHandle: '@?',
            name: '@?',
            textChange: '&?',
            firstRender: '&?',
            component: '@?',
            componentId: '@?',
            required: '@?'
        },
        link: function(scope, element) {
            element = element[0];

            // More customization in http://docs.ckeditor.com/#!/api/CKEDITOR.config-cfg-customConfig
            // Option adjustHeight can be boolean or HTML DOM id. Specifying it will adjust height of the editor to the selected
            // element.
            var defaultOptions = {
                    allowedContent: true,
                    defaultLanguage: 'en',
                    height: editorInitialHeightDefault,
                    adjustHeight: adjustHeightDefault,
                    toolbarCanCollapse: true,
                    toolbarStartupExpanded: false,
                    toolbar: [
                        {name: 'basicstyles', items: ['Bold', 'Italic']},
                        {name: 'styles', items: ['Format']},
                        {name: 'links', items: ['Link', 'Unlink']},
                        {name: 'lists', items: ['NumberedList', 'BulletedList']},
                        '/',
                        {name: 'document', items: ['Source', 'RemoveFormat']},
                        {name: 'tools', items: [ 'Maximize' ]}
                    ],
                    toolbarLocation: 'bottom',
                    removePlugins: 'elementspath,resize,pastetext,pastefromword,clipboard,image',
                    removeButtons: ''
                },
                scrollView,
                resized = false,
                fixedBarsHeight,
                component = scope.component,
                componentId = scope.componentId,
                firstChange = true,
                renderTime,
                editorInitialHeight = editorInitialHeightDefault,
                adjustHeight = adjustHeightDefault;

            // Default to text.
            scope.property = typeof scope.property == 'string' ? scope.property : 'text';

            if (scope.scrollHandle) {
                scrollView = $ionicScrollDelegate.$getByHandle(scope.scrollHandle);
            }

            // Check if we should use rich text editor.
            $mmUtil.isRichTextEditorEnabled().then(function(enabled) {
                var promise;

                scope.richTextEditor = !!enabled;
                renderTime = new Date().getTime();

                if (enabled) {
                    // Get current language to configure the editor.
                    promise = $mmLang.getCurrentLanguage().then(function(lang) {
                        defaultOptions.language = changeLanguageCode(lang);
                    });
                } else {
                    promise = $q.when();
                }

                promise.then(function() {
                    if ($ionicPlatform.isTablet()) {
                        scope.editorOptions = angular.extend(defaultOptions, scope.options, scope.tabletOptions);
                    } else {
                        scope.editorOptions = angular.extend(defaultOptions, scope.options, scope.phoneOptions);
                    }

                    editorInitialHeight = scope.editorOptions.height;
                    adjustHeight = scope.editorOptions.adjustHeight;

                    if (!enabled) {
                        textareaReady();
                    }
                });
            });

            // Function called when textarea is ready.
            function textareaReady() {
                var editorEl;
                $timeout(function() {
                    if (firstChange) {
                        firstChange = false;
                        editorEl = element.querySelector('.mm-textarea');
                        resizeContentTextarea(editorEl);

                        // Listen for event resize.
                        ionic.on('resize', onResize, window);
                    }
                }, 1000);

                scope.$on('$destroy', function() {
                    ionic.off('resize', onResize, window);
                });

                // Window resized.
                function onResize() {
                    resizeContentTextarea(editorEl);
                }
            }

            // Function called when editor is ready.
            scope.editorReady = function() {
                // Editor is ready, setup listeners.
                var collapser = element.querySelector('.cke_toolbox_collapser'),
                    firstButton = element.querySelector('.cke_toolbox_main .cke_toolbar:first-child'),
                    lastButton = element.querySelector('.cke_toolbox_main .cke_toolbar:last-child'),
                    toolbar = element.querySelector('.cke_bottom'),
                    editorEl = element.querySelector('.cke'),
                    contentsEl = element.querySelector('.cke_contents'),
                    sourceCodeButton = element.querySelector('.cke_button__source'),
                    seeingSourceCode = false,
                    wysiwygIframe,
                    unregisterDialogListener,
                    editorController;

                // Search and format contents of wysiwygIframe.
                searchAndFormatWysiwyg(element, component, componentId).then(function(iframe) {
                    wysiwygIframe = iframe;
                });

                // Setup collapser.
                if (firstButton && lastButton && collapser && toolbar) {
                    if (firstButton.offsetTop == lastButton.offsetTop) {
                        // Last button is in the same row as first button, hide the collapser.
                        angular.element(collapser).css('display', 'none');
                    }

                    angular.element(collapser).on('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        angular.element(toolbar).toggleClass('cke_expanded');

                        if (resized) {
                            // Editor is resized and the toolbar height has changed, recalculate it.
                            resizeContent(editorEl, contentsEl, toolbar);
                        }
                    });
                }

                // Compile when source code is done.
                if (sourceCodeButton) {
                    angular.element(sourceCodeButton).on('click', function() {
                        $timeout(function() {
                            seeingSourceCode = !seeingSourceCode;
                            if (!seeingSourceCode) {
                                // User is switching from source code to wysiwyg, re-compile the content once it's done.
                                searchAndFormatWysiwyg(element, component, componentId).then(function(iframe) {
                                    wysiwygIframe = iframe;
                                });
                            }
                        });
                    });
                }

                // If text isn't changed we won't throw firstRender, so throw it manually.
                if (scope.richTextEditor) {
                    $timeout(function() {
                        if (firstChange) {
                            if (scope.firstRender) {
                                scope.firstRender();
                            }
                            firstChange = false;
                            resizeContent(editorEl, contentsEl, toolbar);
                        }
                    }, 1000);
                }

                // Get editor controller.
                editorController = getCKEditorController(element);

                // Listen for event resize.
                ionic.on('resize', onResize, window);

                scope.$on('$destroy', function() {
                    // Destroy instance. It's already done in angular-ckeditor, but it does it too late.
                    if (editorController && editorController.instance) {
                        editorController.instance.destroy(false);
                    }

                    ionic.off('resize', onResize, window);
                    if (unregisterDialogListener) {
                        unregisterDialogListener();
                    }


                });

                // Window resized.
                function onResize() {
                    resizeContent(editorEl, contentsEl, toolbar);

                    if (firstButton.offsetTop == lastButton.offsetTop) {
                        // Last button is in the same row as first button, hide the collapser.
                        angular.element(collapser).css('display', 'none');
                    } else {
                        // Last button is NOT in the same row as first button, show the collapser.
                        angular.element(collapser).css('display', 'block');
                    }
                }
            };

            // Text changed.
            scope.onChange = function() {
                if (scope.richTextEditor && firstChange && scope.firstRender && new Date().getTime() - renderTime < 1000) {
                    // On change triggered by first rendering, call firstRender.
                    scope.firstRender();
                }
                firstChange = false;

                if (scope.textChange) {
                    scope.textChange();
                }
            };

            /**
             * Resize the textarea to fill the visible screen size (except top bar).
             *
             * @param  {Object} editorEl   Textare element
             */
            function resizeContentTextarea(editorEl) {
                var editorHeight = editorInitialHeight,
                    contentVisibleHeight,
                    screenSmallerThanEditor;

                if (typeof fixedBarsHeight == 'undefined') {
                    fixedBarsHeight = calculateFixedBarsHeight(editorEl);
                }

                contentVisibleHeight = $window.innerHeight - fixedBarsHeight;

                // Editor is ready, adjust Height if needed.
                if (adjustHeight && contentVisibleHeight > 0) {
                    var topElement,
                        height;

                    if (adjustHeight !== true) {
                        topElement = document.getElementById(adjustHeight);
                        contentVisibleHeight = $mmUtil.getElementHeight(topElement) || contentVisibleHeight;
                    }

                    height = getSurroundingHeight(element, topElement);
                    if (contentVisibleHeight > height) {
                        editorHeight = contentVisibleHeight - height;
                        editorInitialHeight = editorHeight;
                    }
                }
                screenSmallerThanEditor = contentVisibleHeight > 0 && contentVisibleHeight < editorHeight;

                if (resized && !screenSmallerThanEditor) {
                    // The editor was resized but now it isn't needed anymore, undo the resize.
                    undoResize(editorEl);
                } else if (editorHeight > 60 && (resized || screenSmallerThanEditor || adjustHeight)) {
                    // The visible screen size is lower than the editor size, resize editor to fill the screen.
                    // We don't resize if the content new height is too small.
                    angular.element(editorEl).css('height', editorHeight + 'px');
                    resized = true;
                }
            }

            /**
             * Resize the editor to fill the visible screen size (except top bar).
             *
             * @param  {Object} editorEl   Editor element of CKE (the biggest element .cke)
             * @param  {Object} contentsEl Just the writtable part of CKE (.cke_contents)
             * @param  {Object} toolbar    Toolbar of CKE editor (.cke_bottom)
             */
            function resizeContent(editorEl, contentsEl, toolbar) {
                var toolbarHeight = $mmUtil.getElementHeight(toolbar),
                    editorWithToolbarHeight = editorInitialHeight + toolbarHeight,
                    contentVisibleHeight,
                    editorContentNewHeight,
                    screenSmallerThanEditor,
                    editorMaximized;

                if (typeof fixedBarsHeight == 'undefined') {
                    fixedBarsHeight = calculateFixedBarsHeight(editorEl);
                }

                editorMaximized = !!editorEl.querySelector('.cke_maximized');
                contentVisibleHeight = $window.innerHeight - fixedBarsHeight;

                // Editor is ready, adjust Height if needed.
                if (adjustHeight && !editorMaximized && contentVisibleHeight > 0) {
                    var topElement,
                        height;

                    if (adjustHeight !== true) {
                        topElement = document.getElementById(adjustHeight);
                        contentVisibleHeight = $mmUtil.getElementHeight(topElement) || contentVisibleHeight;
                    }

                    height = getSurroundingHeight(element, topElement);
                    if (contentVisibleHeight > height) {
                        editorWithToolbarHeight = contentVisibleHeight - height;
                        editorInitialHeight = editorWithToolbarHeight - toolbarHeight;
                    }
                }
                screenSmallerThanEditor = !editorMaximized && contentVisibleHeight > 0 &&
                    contentVisibleHeight < editorWithToolbarHeight;
                editorContentNewHeight = editorWithToolbarHeight - toolbarHeight;

                if (resized && !screenSmallerThanEditor) {
                    // The editor was resized but now it isn't needed anymore, undo the resize.
                    undoResize(editorEl, contentsEl);
                } else if (editorContentNewHeight > 60 && (resized || screenSmallerThanEditor || adjustHeight)) {
                    // The visible screen size is lower than the editor size, resize editor to fill the screen.
                    // We don't resize if the content new height is too small.
                    angular.element(editorEl).css('height', editorWithToolbarHeight + 'px');
                    angular.element(contentsEl).css('height', editorContentNewHeight + 'px');
                    resized = true;

                    if (scrollView) {
                        // Check that this editor was the one focused.
                        var focused = document.activeElement;
                        if (focused) {
                            var parentEditor = $mmUtil.closest(focused, '.cke');
                            if (parentEditor == editorEl) {
                                $mmUtil.scrollToElement(editorEl, undefined, scrollView);
                            }
                        }
                    }
                }
            }

            // Undo resize.
            function undoResize(editorEl, contentsEl) {
                if (contentsEl) {
                    // RTE enabled.
                    angular.element(editorEl).css('height', '');
                    angular.element(contentsEl).css('height', editorInitialHeight + 'px');
                } else {
                    // Textarea.
                    angular.element(editorEl).css('height', editorInitialHeight + 'px');
                }
                resized = false;
            }
        }
    };
});

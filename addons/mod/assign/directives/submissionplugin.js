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

angular.module('mm.addons.mod_assign')

/**
 * Directive to render an submission plugin.
 *
 * @module mm.addons.mod_assign
 * @ngdoc directive
 * @name mmaModAssignSubmissionPlugin
 * @description
 * Directive to render submission plugin.
 *
 * It requires to receive a "plugin" scope variable indicating the plugin to render the submission.
 *
 * Parameters received by this directive and shared with the directive to render the plugin (if any):
 *
 * @param {Object} assign          The assign.
 * @param {Object} submission      The submission.
 * @param {Object} plugin          The plugin to render.
 * @param {Boolean} edit           True if editing, false if read only.
 * @param {String} [scrollHandle]  Name of the scroll handle of the page containing the plugin.
 * @param {Boolean} [allowOffline] True to allow offline usage.
 *
 * Also, the directives to render the plugin will receive the following parameters in the scope:
 *
 * @param {String} assignComponent Assignment component.
 * @param {Object} configs         Plugin configs.
 */
.directive('mmaModAssignSubmissionPlugin', function($compile, $mmaModAssignSubmissionDelegate, $mmaModAssign, $mmaModAssignHelper,
            mmaModAssignComponent) {
    return {
        restrict: 'E',
        scope: {
            assign: '=',
            plugin: '=',
            submission: '=',
            edit: '@?',
            scrollHandle: '@?',
            allowOffline: '@?'
        },
        templateUrl: 'addons/mod/assign/templates/submissionplugin.html',
        link: function(scope, element, attributes) {
            var plugin = scope.plugin,
                container = element[0].querySelector('.mma-mod-assign-submission-container'),
                directive;

            if (!plugin || !container) {
                return;
            }

            plugin.name = $mmaModAssignSubmissionDelegate.getPluginName(plugin);
            if (!plugin.name) {
                return;
            }

            scope.assignComponent = mmaModAssignComponent;
            scope.edit = scope.edit && scope.edit !== 'false';
            scope.allowOffline = scope.allowOffline && scope.allowOffline !== 'false';

            // Check if the plugin has defined its own directive to render itself.
            directive = $mmaModAssignSubmissionDelegate.getDirectiveForPlugin(plugin, scope.edit);

            if (directive) {
                // Configs are only used in directives.
                scope.configs = $mmaModAssignHelper.getPluginConfig(scope.assign, 'assignsubmission', plugin.type);

                // Add the directive to the element.
                container.setAttribute(directive, '');
                // Compile the new directive.
                $compile(container)(scope);
            } else {
                // Helper data and fallback.
                scope.text = $mmaModAssign.getSubmissionPluginText(plugin);
                scope.files = $mmaModAssign.getSubmissionPluginAttachments(plugin);
                scope.notSupported = $mmaModAssignSubmissionDelegate.isPluginSupported(plugin.type);
                scope.pluginLoaded = true;
            }
        }
    };
});

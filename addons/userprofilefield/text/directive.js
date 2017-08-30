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

angular.module('mm.addons.userprofilefield_text')

/**
 * Directive to render a text user profile field.
 *
 * @module mm.addons.userprofilefield_text
 * @ngdoc directive
 * @name mmaUserProfileFieldText
 */
.directive('mmaUserProfileFieldText', function($log) {
    $log = $log.getInstance('mmaUserProfileFieldText');

    return {
        restrict: 'A',
        priority: 100,
        templateUrl: 'addons/userprofilefield/text/template.html',
        link: function(scope, element) {
            var field = scope.field;

            if (field && scope.edit && scope.model) {
                field.modelName = 'profile_field_' + field.shortname;

                // Check max length.
                if (field.param2) {
                    field.maxlength = parseInt(field.param2, 10) || '';
                }

                // Check if it's a password or text.
                field.inputType = field.param3 && field.param3 !== '0' && field.param3 !== 'false' ? 'password' : 'text';

                // Initialize the value using default data.
                if (typeof field.defaultdata != 'undefined' && typeof scope.model[field.modelName] == 'undefined') {
                    scope.model[field.modelName] = field.defaultdata;
                }
            }
        }
    };
});

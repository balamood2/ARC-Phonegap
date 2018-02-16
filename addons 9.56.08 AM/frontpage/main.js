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

angular.module('mm.addons.frontpage', [])

.constant('mmaFrontpagePriority', 1000)

.config(function($stateProvider, $mmCoursesDelegateProvider, mmCoreCoursePriority) {

    $stateProvider

    .state('site.frontpage', {
        url: '/frontpage',
        params: {
            moduleid: null // Module to load.
        },
        views: {
            'site': {
                templateUrl: 'addons/frontpage/templates/frontpage.html',
                controller: 'mmaFrontpageCtrl'
            }
        }
    });
})

.config(function($mmSideMenuDelegateProvider, $mmContentLinksDelegateProvider, mmaFrontpagePriority) {
    // Register side menu addon.
    $mmSideMenuDelegateProvider.registerNavHandler('mmaFrontpage', '$mmaFrontPageHandlers.sideMenuNav', mmaFrontpagePriority);
    $mmContentLinksDelegateProvider.registerLinkHandler('mmaFrontpage', '$mmaFrontPageHandlers.linksHandler');
});

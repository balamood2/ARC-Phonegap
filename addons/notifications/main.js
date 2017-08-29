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

angular.module('mm.addons.notifications', [])

.constant('mmaNotificationsListLimit', 20) // Max of notifications to retrieve in each WS call.
.constant('mmaNotificationsPriority', 800)
.constant('mmaNotificationsPreferencesPriority', 500)
.constant('mmaNotificationsReadChangedEvent', 'mma-notifications_read_changed')
.constant('mmaNotificationsReadCronEvent', 'mma-notifications_read_cron')
.constant('mmaNotificationsPushSimulationComponent', 'mmaNotificationsPushSimulation')

.config(function($stateProvider, $mmSideMenuDelegateProvider, mmaNotificationsPriority, $mmSettingsDelegateProvider,
            mmaNotificationsPreferencesPriority) {

    $stateProvider

    .state('site.notifications', {
        url: '/notifications',
        views: {
            'site': {
                templateUrl: 'addons/notifications/templates/list.html',
                controller: 'mmaNotificationsListCtrl'
            }
        }
    })

    .state('site.notifications-preferences', {
        url: '/notifications-preferences',
        views: {
            'site': {
                controller: 'mmaNotificationsPreferencesCtrl',
                templateUrl: 'addons/notifications/templates/preferences.html'
            }
        }
    });

    // Register side menu addon.
    $mmSideMenuDelegateProvider.registerNavHandler('mmaNotifications', '$mmaNotificationsHandlers.sideMenuNav', mmaNotificationsPriority);

    // Register settings handler.
    $mmSettingsDelegateProvider.registerHandler('mmaNotifications:preferences',
            '$mmaNotificationsHandlers.preferences', mmaNotificationsPreferencesPriority);
})

.run(function($log, $mmaNotifications, $mmUtil, $state, $mmAddonManager, $mmCronDelegate, $mmSitesManager, $mmLocalNotifications,
            $mmApp, mmaNotificationsPushSimulationComponent) {
    $log = $log.getInstance('mmaNotifications');

    // Register push notification clicks.
    var $mmPushNotificationsDelegate = $mmAddonManager.get('$mmPushNotificationsDelegate');
    if ($mmPushNotificationsDelegate) {
        $mmPushNotificationsDelegate.registerHandler('mmaNotifications', function(notification) {
            if ($mmUtil.isTrueOrOne(notification.notif)) {
                notificationClicked(notification);
                return true;
            }
        });
    }

    // Register sync process.
    $mmCronDelegate.register('mmaNotificationsMenu', '$mmaNotificationsHandlers.sideMenuNav');

    if ($mmApp.isDesktop()) {
        // Listen for clicks in simulated push notifications.
        $mmLocalNotifications.registerClick(mmaNotificationsPushSimulationComponent, notificationClicked);
    }

    // A push notification belonging to notifications was clicked.
    function notificationClicked(notification) {
        return $mmaNotifications.isPluginEnabledForSite(notification.site).then(function() {
            $mmSitesManager.isFeatureDisabled('$mmSideMenuDelegate_mmaNotifications', notification.site)
                    .then(function(disabled) {
                if (disabled) {
                    // Notifications are disabled, stop.
                    return;
                }

                $mmaNotifications.invalidateNotificationsList().finally(function() {
                    $state.go('redirect', {siteid: notification.site, state: 'site.notifications'});
                });
            });
        });
    }
});

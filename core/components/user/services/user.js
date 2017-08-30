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

angular.module('mm.core.user')

.constant('mmCoreUsersStore', 'users')

.config(function($mmSitesFactoryProvider, mmCoreUsersStore) {
    var stores = [
        {
            name: mmCoreUsersStore,
            keyPath: 'id'
        }
    ];
    $mmSitesFactoryProvider.registerStores(stores);
})

/**
 * Service to provide user functionalities.
 *
 * @module mm.core.user
 * @ngdoc service
 * @name $mmUser
 */
.factory('$mmUser', function($log, $q, $mmSite, $mmUtil, $translate, mmCoreUsersStore, $mmFilepool, $mmSitesManager) {

    $log = $log.getInstance('$mmUser');

    var self = {};

    /**
     * Store user basic information in local DB to be retrieved if the WS call fails.
     *
     * @param  {Number} id User ID.
     * @return {Promise}   Promise resolve when the user is deleted.
     */
    self.deleteStoredUser = function(id) {
        if (!$mmSite.isLoggedIn()) {
            // Not logged in, we can't get the site DB. User logged out or session expired while an operation was ongoing.
            return $q.reject();
        }

        id = parseInt(id, 10);
        if (isNaN(id)) {
            return $q.reject();
        }

        self.invalidateUserCache(id); // Invalidate WS calls.
        return $mmSite.getDb().remove(mmCoreUsersStore, id);
    };

    /**
     * Formats a user address, concatenating address, city and country.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#formatAddress
     * @param  {String} address Address.
     * @param  {String} city    City..
     * @param  {String} country Country.
     * @return {String}         Formatted address.
     */
    self.formatAddress = function(address, city, country) {
        var separator = $translate.instant('mm.core.listsep'),
            values = [address, city, country];

        values = values.filter(function (value) {
            return value && value.length > 0;
        });

        return values.join(separator + " ");
    };

    /**
     * Formats a user role list, translating and concatenating them.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#formatRoleList
     * @param  {Array} roles List of user roles.
     * @return {String}      The formatted roles.
     */
    self.formatRoleList = function(roles) {
        if (!roles || roles.length <= 0) {
            return "";
        }

        var separator = $translate.instant('mm.core.listsep');

        roles = roles.reduce(function (previousValue, currentValue) {
            var role = $translate.instant('mm.user.' + currentValue.shortname);

            if (role.indexOf('mm.user.') < 0) {
                // Only add translated role names.
                previousValue.push(role);
            }
            return previousValue;
        }, []);

        return roles.join(separator + " ");
    };

    /**
     * Get user profile. The type of profile retrieved depends on the params.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#getProfile
     * @param  {Number} userid      User's ID.
     * @param  {Number} [courseid]  Course ID to get course profile, undefined or 0 to get site profile.
     * @param  {Boolean} forceLocal True to retrieve the user data from local DB, false to retrieve it from WS.
     * @return {Promise}            Promise resolved with the user data.
     */
    self.getProfile = function(userid, courseid, forceLocal) {

        var deferred = $q.defer();

        if (forceLocal) {
            self.getUserFromLocal(userid).then(deferred.resolve, function() {
                self.getUserFromWS(userid, courseid).then(deferred.resolve, deferred.reject);
            });
        } else {
            self.getUserFromWS(userid, courseid).then(deferred.resolve, function() {
                self.getUserFromLocal(userid).then(deferred.resolve, deferred.reject);
            });
        }

        return deferred.promise;
    };

    /**
     * Invalidates user WS calls.
     *
     * @param  {Number} userid User ID.
     * @return {String}        Cache key.
     */
    function getUserCacheKey(userid) {
        return 'mmUser:data:'+userid;
    }

    /**
     * Get user basic information from local DB.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#getUserFromLocal
     * @param  {Number} id User ID.
     * @return {Promise}   Promise resolve when the user is retrieved.
     */
    self.getUserFromLocal = function(id) {
        if (!$mmSite.isLoggedIn()) {
            // Not logged in, we can't get the site DB. User logged out or session expired while an operation was ongoing.
            return $q.reject();
        }

        id = parseInt(id, 10);
        if (isNaN(id)) {
            return $q.reject();
        }

        return $mmSite.getDb().get(mmCoreUsersStore, id);
    };

    /**
     * Get user profile from WS.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#getUserFromWS
     * @param  {Number} id         User ID.
     * @param  {Number} [courseid] Course ID to get course profile, undefined or 0 to get site profile.
     * @return {Promise}           Promise resolve when the user is retrieved.
     */
    self.getUserFromWS = function(userid, courseid) {
        userid = parseInt(userid, 10);
        courseid = parseInt(courseid, 10);

        var wsName,
            data,
            preSets ={
                cacheKey: getUserCacheKey(userid)
            };

        // Determine WS and data to use.
        if (courseid > 1) {
            $log.debug('Get participant with ID ' + userid + ' in course '+courseid);
            wsName = 'core_user_get_course_user_profiles';
            data = {
                "userlist[0][userid]": userid,
                "userlist[0][courseid]": courseid
            };
        } else {
            $log.debug('Get user with ID ' + userid);
            if ($mmSite.wsAvailable('core_user_get_users_by_field')) {
                wsName = 'core_user_get_users_by_field';
                data = {
                    'field': 'id',
                    'values[0]': userid
                };
            } else {
                wsName = 'core_user_get_users_by_id';
                data = {
                    'userids[0]': userid
                };
            }
        }

        return $mmSite.read(wsName, data, preSets).then(function(users) {
            if (users.length == 0) {
                return $q.reject();
            }

            var user = users.shift();
            if (user.country) {
                user.country = $mmUtil.getCountryName(user.country);
            }
            self.storeUser(user.id, user.fullname, user.profileimageurl);
            return user;
        });
    };

    /**
     * Invalidates user WS calls.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#invalidateUserCache
     * @param  {Number} userid User ID.
     * @return {Promise}       Promise resolved when the data is invalidated.
     */
    self.invalidateUserCache = function(userid) {
        return $mmSite.invalidateWsCacheForKey(getUserCacheKey(userid));
    };

    /**
     * Check if update profile picture is disabled in a certain site.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#isUpdatePictureDisabled
     * @param  {String} [siteId] Site Id. If not defined, use current site.
     * @return {Promise}         Promise resolved with true if disabled, rejected or resolved with false otherwise.
     */
    self.isUpdatePictureDisabled = function(siteId) {
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return self.isUpdatePictureDisabledInSite(site);
        });
    };

    /**
     * Check if update profile picture is disabled in a certain site.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#isUpdatePictureDisabledInSite
     * @param  {Object} [site] Site. If not defined, use current site.
     * @return {Boolean}       True if disabled, false otherwise.
     */
    self.isUpdatePictureDisabledInSite = function(site) {
        site = site || $mmSite;
        return site.isFeatureDisabled('$mmUserDelegate_picture');
    };

    /**
     * Prefetch user profiles and their images from a certain course. It prevents duplicates.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#prefetchProfiles
     * @param  {Number[]} userIds  List of user IDs.
     * @param  {Number} [courseId] Course the users belong to.
     * @param  {String} [siteId]   Site ID. If not defined, current site.
     * @return {Promise}           Promise resolved when prefetched.
     */
    self.prefetchProfiles = function(userIds, courseId, siteId) {
        siteId = siteId || $mmSite.getId();

        var treated = {},
            promises = [];

        angular.forEach(userIds, function(userId) {
            if (!treated[userId]) {
                treated[userId] = true;

                promises.push(self.getProfile(userId, courseId).then(function(profile) {
                    if (profile.profileimageurl) {
                        $mmFilepool.addToQueueByUrl(siteId, profile.profileimageurl);
                    }
                }));
            }
        });

        return $q.all(promises);
    };

    /**
     * Store user basic information in local DB to be retrieved if the WS call fails.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#storeUser
     * @param  {Number} id       User ID.
     * @param  {String} fullname User full name.
     * @param  {String} avatar   User avatar URL.
     * @return {Promise}         Promise resolve when the user is stored.
     */
    self.storeUser = function(id, fullname, avatar) {
        if (!$mmSite.isLoggedIn()) {
            // Not logged in, we can't get the site DB. User logged out or session expired while an operation was ongoing.
            return $q.reject();
        }

        id = parseInt(id, 10);
        if (isNaN(id)) {
            return $q.reject();
        }

        return $mmSite.getDb().insert(mmCoreUsersStore, {
            id: id,
            fullname: fullname,
            profileimageurl: avatar
        });
    };

    /**
     * Store users basic information in local DB.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#storeUsers
     * @param  {Object[]} users Users to store. Fields stored: id, fullname, profileimageurl.
     * @return {Promise}        Promise resolve when the user is stored.
     */
    self.storeUsers = function(users) {
        var promises = [];

        angular.forEach(users, function(user) {
            var userid = user.id || user.userid,
                img = user.profileimageurl || user.profileimgurl;
            if (typeof userid != 'undefined') {
                promises.push(self.storeUser(userid, user.fullname, img));
            }
        });

        return $q.all(promises);
    };

    /**
     * Update a preference for a user.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#updateUserPreference
     * @param  {String} name     Preference name.
     * @param  {Mixed} value     Preference new value.
     * @param  {Number} [userId] User ID. If not defined, site's current user.
     * @param  {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}         Promise resolved if success.
     */
    self.updateUserPreference = function(name, value, userId, siteId) {
        var preferences = [
            {
                type: name,
                value: value
            }
        ];
        return self.updateUserPreferences(preferences, undefined, userId, siteId);
    };

    /**
     * Update some preferences for a user.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#updateUserPreferences
     * @param  {Object[]} preferences           List of preferences.
     * @param  {Boolean} [disableNotifications] Whether to disable all notifications. Undefined to not update this value.
     * @param  {Number} [userId]                User ID. If not defined, site's current user.
     * @param  {String} [siteId]                Site ID. If not defined, current site.
     * @return {Promise}                        Promise resolved if success.
     */
    self.updateUserPreferences = function(preferences, disableNotifications, userId, siteId) {
        return $mmSitesManager.getSite(siteId).then(function(site) {
            userId = userId || site.getUserId();

            var data = {
                    userid: userId,
                    preferences: preferences
                },
                preSets = {
                    responseExpected: false
                };

            if (typeof disableNotifications != 'undefined') {
                data.emailstop = disableNotifications ? 1 : 0;
            }

            return site.write('core_user_update_user_preferences', data, preSets);
        });
    };

    /*
     * Change the given user profile picture.
     *
     * @module mm.core.user
     * @ngdoc method
     * @name $mmUser#changeProfilePicture
     * @param  {Number} draftItemId New picture draft item id.
     * @param  {Number} id          User ID.
     * @return {Promise}            Promise resolve with the new profileimageurl
     */
    self.changeProfilePicture = function(draftItemId, userId) {
        var data = {
            'draftitemid': draftItemId,
            'delete': 0,
            'userid': userId
        };

        return $mmSite.write('core_user_update_picture', data).then(function(result) {
            if (!result.success) {
                return $q.reject();
            }
            return result.profileimageurl;
        });
    };

    return self;
});

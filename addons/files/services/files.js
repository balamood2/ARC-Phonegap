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

angular.module('mm.addons.files')

.factory('$mmaFiles', function($mmSite, $mmFS, $q, $log, $mmSitesManager, md5) {

    $log = $log.getInstance('$mmaFiles');

    var self = {},
        defaultParams = {
            "contextid": 0,
            "component": "",
            "filearea": "",
            "itemid": 0,
            "filepath": "",
            "filename": ""
        };

    /**
     * Check if core_files_get_files WS call is available.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#canAccessFiles
     * @return {Boolean} True if WS is available, false otherwise.
     */
    self.canAccessFiles = function() {
        return $mmSite.wsAvailable('core_files_get_files');
    };

    /**
     * Check if core_user_add_user_private_files WS call is available.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#canMoveFromDraftToPrivate
     * @param  {String} [siteId] Id of the site to check. If not defined, use current site.
     * @return {Promise}         Promise resolved with true if WS is available, false otherwise.
     */
    self.canMoveFromDraftToPrivate = function(siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.wsAvailable('core_user_add_user_private_files');
        });
    };

    /**
     * Get the list of files.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#getFiles
     * @param  {Object} params A list of parameters accepted by the Web service.
     * @return {Object}        An object containing the files in the key 'entries', and 'count'.
     *                         Additional properties is added to the entries, such as:
     *                          - imgpath: The path to the icon.
     *                          - link: The JSON string of params to get to the file.
     *                          - linkId: A hash of the file parameters.
     */
    self.getFiles = function(params) {
        var options = {};

        options.cacheKey = getFilesListCacheKey(params);

        return $mmSite.read('core_files_get_files', params, options).then(function(result) {
            var data = {
                entries: [],
                count: 0
            };

            if (typeof result.files == 'undefined') {
                return $q.reject();
            }

            angular.forEach(result.files, function(entry) {
                entry.link = {};
                entry.link.contextid = (entry.contextid) ? entry.contextid : "";
                entry.link.component = (entry.component) ? entry.component : "";
                entry.link.filearea = (entry.filearea) ? entry.filearea : "";
                entry.link.itemid = (entry.itemid) ? entry.itemid : 0;
                entry.link.filepath = (entry.filepath) ? entry.filepath : "";
                entry.link.filename = (entry.filename) ? entry.filename : "";

                if (entry.component && entry.isdir) {
                    // Delete unused elements that may break the request.
                    entry.link.filename = "";
                }

                if (entry.isdir) {
                    entry.imgpath = $mmFS.getFolderIcon();
                } else {
                    entry.imgpath = $mmFS.getFileIcon(entry.filename);
                }

                entry.link = JSON.stringify(entry.link);
                entry.linkId = md5.createHash(entry.link);

                data.count += 1;
                data.entries.push(entry);
            });

            return data;
        });
    };

    /**
     * Get cache key for file list WS calls.
     *
     * @param  {Object} params Params of the directory to get.
     * @return {String}        Cache key.
     */
    function getFilesListCacheKey(params) {
        var root = params.component === '' ? 'site' : 'my';
        return 'mmaFiles:list:' + root + ':' + params.contextid + ':' + params.filepath;
    }

    /**
     * Get the private files of the current user.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#getMyFiles
     * @return {Object} See $mmaFiles#getFiles
     */
    self.getMyFiles = function() {
        var params = getMyFilesRootParams();
        return self.getFiles(params);
    };

    /**
     * Get the common part of the cache keys for private files WS calls.
     *
     * @return {String} Cache key.
     */
    function getMyFilesListCommonCacheKey() {
        return 'mmaFiles:list:my';
    }

    /**
     * Get params to get root private files directory.
     *
     * @return {Object} Params.
     */
    function getMyFilesRootParams() {
        var params = angular.copy(defaultParams, {});
        params.component = "user";
        params.filearea = "private";
        params.contextid = -1;
        params.contextlevel = "user";
        params.instanceid = $mmSite.getUserId();
        return params;
    }

    /**
     * Get the site files.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#getSiteFiles
     * @return {Object} See $mmaFiles#getFiles
     */
    self.getSiteFiles = function() {
        var params = angular.copy(defaultParams, {});
        return self.getFiles(params);
    };

    /**
     * Get the common part of the cache keys for site files WS calls.
     *
     * @return {String} Cache key.
     */
    function getSiteFilesListCommonCacheKey() {
        return 'mmaFiles:list:site';
    }

    /**
     * Invalidates list of files in a certain directory.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#invalidateDirectory
     * @param  {String} root     Root of the directory ('my' for private files, 'site' for site files).
     * @param  {String} path     Path to the directory.
     * @param  {String} [siteid] Id of the site to invalidate. If not defined, use current site.
     * @return {Promise}         Promise resolved when the list is invalidated.
     */
    self.invalidateDirectory = function(root, path, siteid) {
        siteid = siteid || $mmSite.getId();

        var params = {};
        if (!path) {
            if (root === 'site') {
                params = angular.copy(defaultParams, {});
            } else if (root === 'my') {
                params = getMyFilesRootParams();
            }
        } else {
            params = JSON.parse(path);
        }

        return $mmSitesManager.getSite(siteid).then(function(site) {
            return site.invalidateWsCacheForKey(getFilesListCacheKey(params));
        });
    };

    /**
     * Invalidates list of private files.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#invalidateMyFiles
     * @return {Promise} Promise resolved when the list is invalidated.
     */
    self.invalidateMyFiles = function() {
        return $mmSite.invalidateWsCacheForKeyStartingWith(getMyFilesListCommonCacheKey());
    };

    /**
     * Invalidates list of site files.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#invalidateSiteFiles
     * @return {Promise} Promise resolved when the list is invalidated.
     */
    self.invalidateSiteFiles = function() {
        return $mmSite.invalidateWsCacheForKeyStartingWith(getSiteFilesListCommonCacheKey());
    };

    /**
     * Check if Files is disabled in a certain site.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#isDisabled
     * @param  {String} [siteId] Site Id. If not defined, use current site.
     * @return {Promise}         Promise resolved with true if disabled, rejected or resolved with false otherwise.
     */
    self.isDisabled = function(siteId) {
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return self.isDisabledInSite(site);
        });
    };

    /**
     * Check if Files is disabled in a certain site.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#isDisabledInSite
     * @param  {Object} [site] Site. If not defined, use current site.
     * @return {Boolean}       True if disabled, false otherwise.
     */
    self.isDisabledInSite = function(site) {
        site = site || $mmSite;
        return site.isFeatureDisabled('$mmSideMenuDelegate_mmaFiles');
    };

    /**
     * Return whether or not the plugin is enabled.
     * Plugin is enabled if user can see private files, can see site files or can upload private files.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#isPluginEnabled
     * @return {Boolean} True if enabled, false otherwise.
     */
    self.isPluginEnabled = function() {
        var canAccessMyFiles = $mmSite.canAccessMyFiles(),
            canViewMyFiles = self.canAccessFiles() && canAccessMyFiles && !self.isPrivateFilesDisabledInSite(),
            canViewSiteFiles = !self.isSiteFilesDisabledInSite(),
            canUploadFiles = canAccessMyFiles && $mmSite.canUploadFiles() && !self.isUploadDisabledInSite();

        return canViewMyFiles || canViewSiteFiles || canUploadFiles;
    };

    /**
     * Check if private files is disabled in a certain site.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#isPrivateFilesDisabled
     * @param  {String} [siteId] Site Id. If not defined, use current site.
     * @return {Promise}         Promise resolved with true if disabled, rejected or resolved with false otherwise.
     */
    self.isPrivateFilesDisabled = function(siteId) {
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return self.isPrivateFilesDisabledInSite(site);
        });
    };

    /**
     * Check if private files is disabled in a certain site.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#isPrivateFilesDisabledInSite
     * @param  {Object} [site] Site. If not defined, use current site.
     * @return {Boolean}       True if disabled, false otherwise.
     */
    self.isPrivateFilesDisabledInSite = function(site) {
        site = site || $mmSite;
        return site.isFeatureDisabled('files_privatefiles');
    };

    /**
     * Check if site files is disabled in a certain site.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#isSiteFilesDisabled
     * @param  {String} [siteId] Site Id. If not defined, use current site.
     * @return {Promise}         Promise resolved with true if disabled, rejected or resolved with false otherwise.
     */
    self.isSiteFilesDisabled = function(siteId) {
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return self.isSiteFilesDisabledInSite(site);
        });
    };

    /**
     * Check if site files is disabled in a certain site.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#isSiteFilesDisabledInSite
     * @param  {Object} [site] Site. If not defined, use current site.
     * @return {Boolean}       True if disabled, false otherwise.
     */
    self.isSiteFilesDisabledInSite = function(site) {
        site = site || $mmSite;
        return site.isFeatureDisabled('files_sitefiles');
    };

    /**
     * Check if upload files is disabled in a certain site.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#isUploadDisabled
     * @param  {String} [siteId] Site Id. If not defined, use current site.
     * @return {Promise}         Promise resolved with true if disabled, rejected or resolved with false otherwise.
     */
    self.isUploadDisabled = function(siteId) {
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return self.isUploadDisabledInSite(site);
        });
    };

    /**
     * Check if upload files is disabled in a certain site.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#isUploadDisabledInSite
     * @param  {Object} [site] Site. If not defined, use current site.
     * @return {Boolean}       True if disabled, false otherwise.
     */
    self.isUploadDisabledInSite = function(site) {
        site = site || $mmSite;
        return site.isFeatureDisabled('files_upload');
    };

    /**
     * Move a file from draft area to private files.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#moveFromDraftToPrivate
     * @param  {Number} draftId  The draft area ID of the file.
     * @param  {String} [siteid] ID of the site. If not defined, use current site.
     * @return {Promise}         Promise resolved in success, rejected otherwise.
     */
    self.moveFromDraftToPrivate = function(draftId, siteId) {
        siteId = siteId || $mmSite.getId();

        var params = {
                draftid: draftId
            },
            preSets = {
                responseExpected: false
            };

        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.write('core_user_add_user_private_files', params, preSets);
        });
    };

    /**
     * Check the Moodle version in order to check if file should be moved from draft to private files.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#shouldMoveFromDraftToPrivate
     * @param  {String} [siteId] Id of the site to check. If not defined, use current site.
     * @return {Promise}         Resolved with true if should be moved, false otherwise.
     */
    self.shouldMoveFromDraftToPrivate = function(siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.isVersionGreaterEqualThan('3.1.0');
        });
    };

    /**
     * Check the Moodle version in order to check if upload files is working.
     *
     * @module mm.addons.files
     * @ngdoc method
     * @name $mmaFiles#versionCanUploadFiles
     * @param  {String} [siteId] Id of the site to check. If not defined, use current site.
     * @return {Promise}         Resolved with true if WS is working, false otherwise.
     */
    self.versionCanUploadFiles = function(siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            if (site.isVersionGreaterEqualThan('3.1.1')) {
                // In Moodle 3.1.1 or higher we need a WS to move to private files.
                return self.canMoveFromDraftToPrivate(siteId);
            } else if (site.isVersionGreaterEqualThan('3.1.0')) {
                // Upload private files doesn't work for Moodle 3.1.0 due to a bug.
                return false;
            }

            return true;
        });
    };

    return self;
});

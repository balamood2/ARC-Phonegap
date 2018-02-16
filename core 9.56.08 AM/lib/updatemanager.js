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

.constant('mmCoreVersionApplied', 'version_applied')

/**
 * Factory to handle app updates. This factory shouldn't be used outside of core.
 *
 * @module mm.core
 * @ngdoc service
 * @name $mmUpdateManager
 * @description
 * This service handles processes that need to be run when updating the app, like migrate MM1 sites to MM2.
 */
.factory('$mmUpdateManager', function($log, $q, $mmConfig, $mmSitesManager, $mmFS, $cordovaLocalNotification, $mmLocalNotifications,
            $mmApp, $mmEvents, mmCoreSitesStore, mmCoreVersionApplied, mmCoreEventSiteAdded, mmCoreEventSiteUpdated,
            mmCoreEventSiteDeleted, $injector, $mmFilepool, mmCoreCourseModulesStore, mmFilepoolLinksStore, $mmAddonManager,
            mmFilepoolPackagesStore, mmCoreConfigConstants) {

    $log = $log.getInstance('$mmUpdateManager');

    var self = {},
        sitesFilePath = 'migration/sites.json';

    /**
     * Check if the app has been updated and performs the needed processes.
     * This function shouldn't be used outside of core.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmUpdateManager#check
     * @return {Promise} Promise resolved when the update process finishes.
     */
    self.check = function() {
        var promises = [],
            versionCode = mmCoreConfigConstants.versioncode;

        return $mmConfig.get(mmCoreVersionApplied, 0).then(function(versionApplied) {

            if (versionCode >= 391 && versionApplied < 391) {
                // Migrating from MM1 to MM2.
                promises.push(migrateMM1Sites());
                // Ignore errors in clearAppFolder. We don't want to clear the folder
                // everytime the app is opened if something goes wrong.
                promises.push(clearAppFolder().catch(function() {}));
            }

            if (versionCode >= 2003 && versionApplied < 2003) {
                promises.push(cancelAndroidNotifications());
            }

            if (versionCode >= 2003) {
                setStoreSitesInFile();
            }

            if (versionCode >= 2007 && versionApplied < 2007) {
                promises.push(migrateModulesStatus());
            }

            if (versionCode >= 2013 && versionApplied < 2013) {
                promises.push(migrateFileExtensions());
            }

            if (versionCode >= 2017 && versionApplied < 2017) {
                promises.push(setCalendarDefaultNotifTime());
                promises.push(setSitesConfig());
                promises.push(migrateWikiNewPagesStore());
            }

            if (versionCode >= 2018 && versionApplied < 2018) {
                promises.push(adaptForumOfflineStores());
            }

            return $q.all(promises).then(function() {
                return $mmConfig.set(mmCoreVersionApplied, versionCode);
            }).catch(function() {
                $log.error('Error applying update from ' + versionApplied + ' to ' + versionCode);
            });
        });
    };

    /**
     * Clear the app folder.
     *
     * @return {Promise} Promise resolved when the folder is cleared.
     */
    function clearAppFolder() {
        if ($mmFS.isAvailable()) {
            return $mmFS.getDirectoryContents('').then(function(entries) {
                var promises = [];
                angular.forEach(entries, function(entry) {
                    // In Android, don't delete 'cache' and 'files' folders, created by the OS.
                    var canDeleteAndroid = ionic.Platform.isAndroid() && entry.name !== 'cache' && entry.name !== 'files';
                    var canDeleteIOS = ionic.Platform.isIOS() && entry.name !== 'NoCloud';
                    if (canDeleteIOS || canDeleteAndroid) {
                        promises.push($mmFS.removeDir(entry.name));
                    }
                });
                return $q.all(promises);
            });
        } else {
            return $q.when();
        }
    }

    /**
     * Migrate MoodleMobile 1 sites to MoodleMobile 2.
     *
     * @return {Promise} Promise resolved when the sites are migrated.
     */
    function migrateMM1Sites() {
        var sites = localStorage.getItem('sites'),
            promises = [];

        if (sites) {
            sites = sites.split(',');

            angular.forEach(sites, function(siteid) {
                if (!siteid) {
                    return;
                }

                $log.debug('Migrating site from MoodleMobile 1: ' + siteid);
                var site = localStorage.getItem('sites-'+siteid),
                    infos;

                if (site) {
                    try {
                        site = JSON.parse(site);
                    } catch(ex) {
                        // Invalid site. Shouldn't happen.
                        $log.warn('Site ' + siteid + ' data is invalid. Ignoring.');
                        return;
                    }

                    // In MM1 site info is mixed with site basic data (id, token, siteurl).
                    infos = angular.copy(site);
                    delete infos.id;
                    delete infos.token;
                    promises.push($mmSitesManager.addSite(site.id, site.siteurl, site.token, infos));
                } else {
                    $log.warn('Site ' + siteid + ' not found in local storage. Ignoring.');
                }
            });
        }

        return $q.all(promises).then(function() {
            if (sites) {
                localStorage.clear();
            }
        });
    }

    /**
     * Cancel all Android notifications. MM 2.0 was released with a bug in notifications ID (Android). These IDs were stored in
     * SharedPreferences, cancel them all will clear the stored values. @see MOBILE-1148.
     *
     * @return {Promise} Promise resolved when the notifications are cancelled.
     */
    function cancelAndroidNotifications() {
        if ($mmLocalNotifications.isAvailable() && ionic.Platform.isAndroid()) {
            return $cordovaLocalNotification.cancelAll().catch(function() {
                $log.error('Error cancelling Android notifications.');
            });
        }
        return $q.when();
    }

    /**
     * Sets the events to store the sites in a file.
     */
    function setStoreSitesInFile() {
        $mmEvents.on(mmCoreEventSiteAdded, storeSitesInFile);
        $mmEvents.on(mmCoreEventSiteUpdated, storeSitesInFile);
        $mmEvents.on(mmCoreEventSiteDeleted, storeSitesInFile);
        storeSitesInFile();
    }

    /**
     * Get sites stored in a file. It'll be used to migrate to Crosswalk if users skipped SQLite migration version.
     *
     * @return {Promise} Promise resolved with sites are retrieved. Resolve param is the sites list.
     */
    function getSitesStoredInFile() {
        if ($mmFS.isAvailable()) {
            return $mmFS.readFile(sitesFilePath).then(function(sites) {
                try {
                    sites = JSON.parse(sites);
                } catch (ex) {
                    sites = [];
                }
                return sites;
            }).catch(function() {
                // Error reading, probably file doesn't exist. Return empty list.
                return [];
            });
        } else {
            return $q.when([]);
        }
    }

    /**
     * Store sites in a file. It'll be used to migrate to Crosswalk if users skipped SQLite migration version.
     *
     * @return {Promise} Promise resolved when file is written.
     */
    function storeSitesInFile() {
        if ($mmFS.isAvailable()) {
            return $mmApp.getDB().getAll(mmCoreSitesStore).then(function(sites) {
                angular.forEach(sites, function(site) {
                    site.token = 'private'; // Remove the token, we don't want it written in a file.
                });
                return $mmFS.writeFile(sitesFilePath, JSON.stringify(sites));
            });
        } else {
            return $q.when();
        }
    }

    /**
     * Delete file with sites stored.
     *
     * @return {Promise} Promise resolved when file is deleted.
     */
    function deleteSitesFile() {
        if ($mmFS.isAvailable()) {
            return $mmFS.removeFile(sitesFilePath);
        } else {
            return $q.when();
        }
    }

    /**
     * Migrate mmCoreCourseModulesStore to mmFilepoolPackagesStore.
     *
     * @return {Promise} Promise resolved when the migration is finished.
     */
    function migrateModulesStatus() {
        var components = [];
        components.push($injector.get('mmaModBookComponent'));
        components.push($injector.get('mmaModImscpComponent'));
        components.push($injector.get('mmaModPageComponent'));
        components.push($injector.get('mmaModResourceComponent'));

        return $mmSitesManager.getSitesIds().then(function(sites) {
            var promises = [];
            angular.forEach(sites, function(siteId) {
                promises.push(migrateSiteModulesStatus(siteId, components));
            });
            return $q.all(promises);
        });
    }

    /**
     * Migrates the modules status from a certain site.
     *
     * @param {String} siteId       Site ID.
     * @param {String[]} components Components to check.
     * @return {Promise}            Promise resolved when the site migration is finished.
     */
    function migrateSiteModulesStatus(siteId, components) {
        $log.debug('Migrate site modules status from site ' + siteId);

        return $mmSitesManager.getSiteDb(siteId).then(function(db) {
            return db.getAll(mmCoreCourseModulesStore).then(function(entries) {
                var promises = [];

                angular.forEach(entries, function(entry) {
                    if (!parseInt(entry.id)) {
                        return; // The id is not a number, ignore it.
                    }

                    promises.push(determineComponent(db, entry.id, components).then(function(component) {
                        if (component) {
                            // Add a new entry in filepool store.
                            // We don't use $mmFilepool#storePackageStatus because we want to keep previousStatus.
                            entry.component = component;
                            entry.componentId = entry.id;
                            entry.id = $mmFilepool.getPackageId(component, entry.id);
                            promises.push(db.insert(mmFilepoolPackagesStore, entry));
                        }
                    }));
                });

                return $q.all(promises).then(function() {
                    // Success creating all the new entries. Let's remove the old ones.
                    return db.removeAll(mmCoreCourseModulesStore).catch(function() {
                        // Ignore errors.
                    });
                });
            });
        });
    }

    /**
     * Migrates files filling extensions.
     *
     * @return {Promise}            Promise resolved when the site migration is finished.
     */
    function migrateFileExtensions() {
        return $mmSitesManager.getSitesIds().then(function(sites) {
            var promises = [];
            angular.forEach(sites, function(siteId) {
                promises.push($mmFilepool.fillMissingExtensionInFiles(siteId));
            });
            promises.push($mmFilepool.treatExtensionInQueue());
            return $q.all(promises);
        });
    }

    /**
     * Determines the component of a module status entry.
     *
     * @param  {Object} db           Site database.
     * @param  {Number} componentId  Component ID.
     * @param  {String[]} components List of components to check.
     * @return {Promise}             Promise resolved with the component or undefined if no component found.
     */
    function determineComponent(db, componentId, components) {
        var promises = [],
            component;

        angular.forEach(components, function(c) {
            if (c) {
                promises.push(db.whereEqual(mmFilepoolLinksStore, 'componentAndId', [c, componentId]).then(function(items) {
                    if (items.length) {
                        component = c;
                    }
                }).catch(function() {
                    // Never reject.
                }));
            }
        });

        return $q.all(promises).then(function() {
            return component;
        });
    }

    /**
     * Calendar default notification time is configurable from version 3.2.1, and a new option "Default" is added.
     * All events that were configured to use the fixed default time should now be configured to use "Default" option.
     *
     * @return {Promise} Promise resolved when the events are configured.
     */
    function setCalendarDefaultNotifTime() {
        if (!$mmLocalNotifications.isAvailable()) {
            // Local notif not available, nothing to do.
            return $q.when();
        }

        var $mmaCalendar = $mmAddonManager.get('$mmaCalendar'),
            mmaCalendarDefaultNotifTime = $mmAddonManager.get('mmaCalendarDefaultNotifTime');

        if (!$mmaCalendar || typeof mmaCalendarDefaultNotifTime == 'undefined') {
            // Calendar plugin not available. Stop.
            return $q.when();
        }

        return $mmSitesManager.getSitesIds().then(function(siteIds) {

            var promises = [];
            angular.forEach(siteIds, function(siteId) {
                // Get stored events.
                promises.push($mmaCalendar.getAllEventsFromLocalDb(siteId).then(function(events) {
                    var eventPromises = [];

                    angular.forEach(events, function(event) {
                        if (event.notificationtime == mmaCalendarDefaultNotifTime) {
                            event.notificationtime = -1;
                            eventPromises.push($mmaCalendar.storeEventInLocalDb(event, siteId));
                        }
                    });

                    return $q.all(eventPromises);
                }));
            });

            return $q.all(promises);
        });
    }

    /**
     * In version 3.2.1 we want the site config to be stored in each site if available.
     * Since it can be slow, we'll only block retrieving the config of current site, the rest will be in background.
     *
     * @return {Promise} Promise resolved when the config is loaded for the current site (if any).
     */
    function setSitesConfig() {
        return $mmSitesManager.getSitesIds().then(function(siteIds) {

            return $mmSitesManager.getStoredCurrentSiteId().catch(function() {
                // Error getting current site.
            }).then(function(currentSiteId) {
                var promise;

                // Load the config of current site first.
                if (currentSiteId) {
                    promise = setSiteConfig(currentSiteId);
                } else {
                    promise = $q.when();
                }

                // Load the config of rest of sites in background.
                angular.forEach(siteIds, function(siteId) {
                    if (siteId != currentSiteId) {
                        setSiteConfig(siteId);
                    }
                });

                return promise;
            });
        });
    }

    /**
     * Store the config of a site.
     *
     * @param  {String} siteId       Site ID.
     * @return {Promise} Promise resolved when the config is loaded for the site.
     */
    function setSiteConfig(siteId) {
        return $mmSitesManager.getSite(siteId).then(function(site) {
            if (site.getStoredConfig() || !site.wsAvailable('tool_mobile_get_config')) {
                // Site already has the config or it cannot be retrieved. Stop.
                return;
            }

            // Get the site config.
            return site.getConfig().then(function(config) {
                return $mmSitesManager.addSite(site.getId(), site.getURL(),
                        site.getToken(), site.getInfo(), site.getPrivateToken(), config);
            }).catch(function() {
                // Ignore errors.
            });
        });
    }

    /**
     * The store for new wiki pages had changed the number of index in the keyPath. To avoid problems and loosing data, old store
     * is going to be migrated to a new one and old entries deleted once migrated.
     * Since it can be slow, we'll only block migrating the db of current site, the rest will be in background.
     *
     * @return {Promise} Promise resolved when the db is migrated.
     */
    function migrateWikiNewPagesStore() {
        return $mmSitesManager.getSitesIds().then(function(siteIds) {

            return $mmSitesManager.getStoredCurrentSiteId().catch(function() {
                // Error getting current site.
            }).then(function(currentSiteId) {
                var promise;

                // Load the config of current site first.
                if (currentSiteId) {
                    promise = migrateWikiNewPagesSiteStore(currentSiteId);
                } else {
                    promise = $q.when();
                }

                // Load the config of rest of sites in background.
                angular.forEach(siteIds, function(siteId) {
                    if (siteId != currentSiteId) {
                        migrateWikiNewPagesSiteStore(siteId);
                    }
                });

                return promise;
            });
        });
    }

    /**
     * Migrate the new wiki pages store of one site. If any error, data will be lost without asking.
     *
     * @param  {String} siteId       Site ID.
     * @return {Promise} Promise resolved when the data is migraded for the site.
     */
    function migrateWikiNewPagesSiteStore(siteId) {
        return $mmSitesManager.getSite(siteId).then(function(site) {
            var $mmaModWikiOffline = $injector.get('$mmaModWikiOffline'),
                oldStorageName = 'mma_mod_wiki_new_pages', // Old mmaModWikiNewPagesStore constant.
                db = site.getDb();

            try {
                return db.getAll(oldStorageName).then(function(pages) {
                    if (pages.length > 0) {
                        $log.debug('Found ' + pages.length + ' new wiki pages from old store to migrate on site' + siteId);

                        var promises = [];
                        angular.forEach(pages, function(page) {
                            if (page.subwikiid > 0) {
                                promises.push($mmaModWikiOffline.saveNewPage(page.title, page.cachedcontent, page.subwikiid, 0, 0,
                                    0, siteId));
                            }
                        });

                        return $q.all(promises).finally(function() {
                            db.removeAll(oldStorageName);
                        });
                    }
                }).catch(function() {
                    // Fail silently.
                    return $q.when();
                });
            } catch (e) {
                // Fail silently.
            }
            // Fail silently.
            return $q.when();
        });
    }

    /**
     * The data stored for offline discussions and posts changed its format. Adapt the entries already stored.
     * Since it can be slow, we'll only block migrating the db of current site, the rest will be in background.
     *
     * @return {Promise} Promise resolved when the db is migrated.
     */
    function adaptForumOfflineStores() {
        return $mmSitesManager.getSitesIds().then(function(siteIds) {

            return $mmSitesManager.getStoredCurrentSiteId().catch(function() {
                // Error getting current site.
            }).then(function(currentSiteId) {
                var promise;

                // Load the config of current site first.
                if (currentSiteId) {
                    promise = adaptForumOfflineSiteStores(currentSiteId);
                } else {
                    promise = $q.when();
                }

                // Load the config of rest of sites in background.
                angular.forEach(siteIds, function(siteId) {
                    if (siteId != currentSiteId) {
                        adaptForumOfflineSiteStores(siteId);
                    }
                });

                return promise;
            });
        });
    }

    /**
     * The data stored for offline discussions and posts changed its format. Adapt the entries already stored.
     *
     * @param  {String} siteId Site ID.
     * @return {Promise}       Promise resolved when the data is migrated for the site.
     */
    function adaptForumOfflineSiteStores(siteId) {
        return $mmSitesManager.getSite(siteId).then(function(site) {
            var promises = [],
                $mmaModForumOffline = $injector.get('$mmaModForumOffline'),
                mmaModForumOfflineDiscussionsStore = $injector.get('mmaModForumOfflineDiscussionsStore'),
                mmaModForumOfflineRepliesStore = $injector.get('mmaModForumOfflineRepliesStore');

            // Adapt new discussions.
            promises.push($mmaModForumOffline.getAllNewDiscussions(siteId).then(function(discs) {
                var subPromises = [];

                angular.forEach(discs, function(disc) {
                    // Put subscribe and attachments into an options object.
                    disc.options = {
                        discussionsubscribe: disc.subscribe
                    };
                    if (disc.attachments) {
                        disc.options.attachmentsid = disc.attachments;
                    }
                    delete disc.subscribe;
                    delete disc.attachments;

                    subPromises.push(site.getDb().insert(mmaModForumOfflineDiscussionsStore, disc));
                });

                return $q.all(subPromises);
            }));

            // Adapt replies.
            promises.push($mmaModForumOffline.getAllReplies(siteId).then(function(replies) {
                var subPromises = [];

                angular.forEach(replies, function(reply) {
                    // Put attachments into an options object.
                    reply.options = {};
                    if (reply.attachments) {
                        reply.options.attachmentsid = reply.attachments;
                    }
                    delete reply.attachments;

                    subPromises.push(site.getDb().insert(mmaModForumOfflineRepliesStore, reply));
                });

                return $q.all(subPromises);
            }));

            return $q.all(promises);
        });
    }

    return self;
});

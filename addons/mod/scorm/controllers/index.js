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

angular.module('mm.addons.mod_scorm')

/**
 * SCORM index controller.
 *
 * @module mm.addons.mod_scorm
 * @ngdoc controller
 * @name mmaModScormIndexCtrl
 */
.controller('mmaModScormIndexCtrl', function($scope, $stateParams, $mmaModScorm, $mmUtil, $q, $mmCourse, $ionicScrollDelegate,
            $mmCoursePrefetchDelegate, $mmaModScormHelper, $mmEvents, $mmSite, $state, mmCoreOutdated, mmCoreNotDownloaded,
            mmCoreDownloading, mmaModScormComponent, mmCoreEventPackageStatusChanged, $ionicHistory, mmaModScormEventAutomSynced,
            $mmaModScormSync, $timeout, $mmText, $translate, $mmaModScormPrefetchHandler, $mmApp, $mmCourseHelper,
            mmCoreEventOnlineStatusChanged) {

    var module = $stateParams.module || {},
        courseid = $stateParams.courseid,
        scorm,
        statusObserver, syncObserver, onlineObserver,
        currentStatus,
        lastAttempt,
        lastOffline = false,
        attempts,
        scrollView = $ionicScrollDelegate.$getByHandle('mmaModScormIndexScroll');

    $scope.title = module.name;
    $scope.description = module.description;
    $scope.moduleUrl = module.url;
    $scope.moduleName = $mmCourse.translateModuleName('scorm');
    $scope.currentOrganization = {};
    $scope.scormOptions = {
        mode: $mmaModScorm.MODENORMAL
    };
    $scope.refreshIcon = 'spinner';
    $scope.syncIcon = 'spinner';
    $scope.component = mmaModScormComponent;
    $scope.componentId = module.id;

    $scope.modenormal = $mmaModScorm.MODENORMAL;
    $scope.modebrowse = $mmaModScorm.MODEBROWSE;

    // Convenience function to get SCORM data.
    function fetchScormData(refresh, checkCompletion, showErrors) {
        $scope.isOnline = $mmApp.isOnline();
        return $mmaModScorm.getScorm(courseid, module.id, module.url).then(function(scormData) {
            scorm = scormData;

            $scope.title = scorm.name || $scope.title;
            $scope.description = scorm.intro || $scope.description;
            $scope.scorm = scorm;

            var result = $mmaModScorm.isScormSupported(scorm);
            if (result === true) {
                $scope.errorMessage = '';
            } else {
                $scope.errorMessage = result;
            }

            if (scorm.warningmessage) {
                return; // SCORM is closed or not open yet, we can't get more data.
            }

            return syncScorm(showErrors).catch(function() {
                // Ignore errors, keep getting data even if sync fails.
            }).then(function() {

                // No need to return this promise, it should be faster than the rest.
                $mmaModScormHelper.getScormReadableSyncTime(scorm.id).then(function(syncTime) {
                    $scope.syncTime = syncTime;
                });

                if (checkCompletion) {
                    $mmCourse.checkModuleCompletion(courseid, module.completionstatus);
                }

                // Get the number of attempts and check if SCORM is incomplete.
                return $mmaModScorm.getAttemptCount(scorm.id).then(function(attemptsData) {
                    attempts = attemptsData;
                    $scope.hasOffline = attempts.offline.length; // Show sync button only if there are offline attempts.

                    // Determine the attempt that will be continued or reviewed.
                    return $mmaModScormHelper.determineAttemptToContinue(scorm, attempts).then(function(attempt) {
                        lastAttempt = attempt.number;
                        lastOffline = attempt.offline;
                        if (lastAttempt != attempts.lastAttempt.number) {
                            $scope.attemptToContinue = lastAttempt;
                        } else {
                            delete $scope.attemptToContinue;
                        }

                        return $mmaModScorm.isAttemptIncomplete(scorm.id, lastAttempt, lastOffline).then(function(incomplete) {
                            var promises = [];

                            scorm.incomplete = incomplete;
                            scorm.numAttempts = attempts.total;
                            scorm.grademethodReadable = $mmaModScorm.getScormGradeMethod(scorm);
                            scorm.attemptsLeft = $mmaModScorm.countAttemptsLeft(scorm, attempts.lastAttempt.number);
                            if (scorm.forceattempt && scorm.incomplete) {
                                $scope.scormOptions.newAttempt = true;
                            }

                            promises.push(getReportedGrades());

                            promises.push(fetchStructure());

                            if (!scorm.packagesize && $scope.errorMessage === '') {
                                // SCORM is supported but we don't have package size. Try to calculate it.
                                promises.push($mmaModScorm.calculateScormSize(scorm).then(function(size) {
                                    scorm.packagesize = size;
                                }));
                            }

                            // Handle status. We don't add getStatus to promises because it should be fast.
                            setStatusListener();
                            getStatus().then(showStatus);

                            return $q.all(promises);
                        });
                    });
                }).catch(function(message) {
                    return showError(message);
                });

            });

        }, function(message) {
            if (!refresh) {
                // Get scorm failed, retry without using cache since it might be a new activity.
                return refreshData();
            }
            return showError(message);
        }).then(function() {
            $scope.allDataLoaded = true;

            // All data obtained, now fill the context menu.
            $mmCourseHelper.fillContextMenu($scope, module, courseid, refresh, mmaModScormComponent);
        });
    }

    // Show error message and return a rejected promise.
    function showError(message, defaultMessage) {
        defaultMessage = defaultMessage || 'mma.mod_scorm.errorgetscorm';
        if (message) {
            $mmUtil.showErrorModal(message);
        } else {
            $mmUtil.showErrorModal(defaultMessage, true);
        }
        return $q.reject();
    }

    // Get the grades of each attempt and the grade of the SCORM.
    function getReportedGrades() {
        var promises = [];
        scorm.onlineAttempts = {};
        scorm.offlineAttempts = {};
        // Calculate the grade for each attempt.
        attempts.online.forEach(function(attempt) {
            // Check that attempt isn't in offline to prevent showing the same attempt twice. Offline should be more recent.
            if (attempts.offline.indexOf(attempt) == -1) {
                promises.push(getAttemptGrade(scorm, attempt));
            }
        });
        attempts.offline.forEach(function(attempt) {
            promises.push(getAttemptGrade(scorm, attempt, true));
        });

        return $q.all(promises).then(function() {

            // Calculate the grade of the whole SCORM. We only use online attempts to calculate this data.
            scorm.grade = $mmaModScorm.calculateScormGrade(scorm, scorm.onlineAttempts);

            // Now format the grades.
            angular.forEach(scorm.onlineAttempts, function(attempt) {
                attempt.grade = $mmaModScorm.formatGrade(scorm, attempt.grade);
            });
            angular.forEach(scorm.offlineAttempts, function(attempt) {
                attempt.grade = $mmaModScorm.formatGrade(scorm, attempt.grade);
            });
            scorm.grade = $mmaModScorm.formatGrade(scorm, scorm.grade);
        });
    }

    // Convenience function to get the grade of an attempt and add it to the scorm attempts list.
    function getAttemptGrade(scorm, attempt, offline) {
        return $mmaModScorm.getAttemptGrade(scorm, attempt, offline).then(function(grade) {
            var entry = {
                number: attempt,
                grade: grade
            };
            if (offline) {
                scorm.offlineAttempts[attempt] = entry;
            } else {
                scorm.onlineAttempts[attempt] = entry;
            }
        });
    }

    // Fetch the structure of the SCORM (TOC).
    function fetchStructure() {
        return $mmaModScorm.getOrganizations(scorm.id).then(function(organizations) {
            $scope.organizations = organizations;

            if (!$scope.currentOrganization.identifier) {
                // Load first organization (if any).
                if (organizations.length) {
                    $scope.currentOrganization.identifier = organizations[0].identifier;
                } else {
                    $scope.currentOrganization.identifier = '';
                }
            }

            return loadOrganizationToc($scope.currentOrganization.identifier);
        });
    }

    // Load the TOC of a certain organization.
    function loadOrganizationToc(organizationId) {
        if (!scorm.displaycoursestructure) {
            // TOC is not displayed, no need to load it.
            return $q.when();
        }

        $scope.loadingToc = true;
        return $mmaModScorm.getOrganizationToc(scorm.id, organizationId, lastAttempt, lastOffline).then(function(toc) {
            $scope.toc = $mmaModScorm.formatTocToArray(toc);
            // Get images for each SCO.
            angular.forEach($scope.toc, function(sco) {
                sco.image = $mmaModScorm.getScoStatusIcon(sco, scorm.incomplete);
            });
            // Search organization title.
            angular.forEach($scope.organizations, function(org) {
                if (org.identifier == organizationId) {
                    $scope.currentOrganization.title = org.title;
                }
            });
            // Resize scroll to prevent empty spaces if new TOC is shorter than previous TOC.
            $ionicScrollDelegate.resize();
        }).finally(function() {
            $scope.loadingToc = false;
        });
    }

    // Get status of the SCORM.
    function getStatus() {
        return $mmCoursePrefetchDelegate.getModuleStatus(module, courseid, scorm.sha1hash, 0);
    }

    // Set a listener to monitor changes on this SCORM status to show a message to the user.
    function setStatusListener() {
        if (typeof statusObserver !== 'undefined') {
            return; // Already set.
        }

        // Listen for changes on this module status to show a message to the user.
        statusObserver = $mmEvents.on(mmCoreEventPackageStatusChanged, function(data) {
            if (data.siteid === $mmSite.getId() && data.componentId === scorm.coursemodule &&
                    data.component === mmaModScormComponent) {
                showStatus(data.status);
            }
        });
    }

    // Showing or hide a status message depending on the SCORM status.
    function showStatus(status) {
        currentStatus = status;

        if (status == mmCoreOutdated && scorm) {
            // Only show the outdated message if the file should be downloaded.
            $mmaModScorm.shouldDownloadMainFile(scorm, true).then(function(download) {
                $scope.statusMessage = download ? 'mma.mod_scorm.scormstatusoutdated' : '';
            });
        } else if (status == mmCoreNotDownloaded) {
            $scope.statusMessage = 'mma.mod_scorm.scormstatusnotdownloaded';
        } else if (status == mmCoreDownloading) {
            if (!$scope.downloading) {
                // It's being downloaded right now but the view isn't tracking it. "Restore" the download.
                downloadScormPackage(true);
            }
        } else {
            $scope.statusMessage = '';
        }
    }

    // Refreshes data.
    function refreshData(dontForceSync, checkCompletion, showErrors) {
        var promises = [];
        promises.push($mmaModScorm.invalidateScormData(courseid));
        if (scorm) {
            promises.push($mmaModScorm.invalidateAllScormData(scorm.id));
        }

        return $q.all(promises).finally(function() {
            return fetchScormData(!dontForceSync, checkCompletion, showErrors);
        });
    }

    // Download a SCORM package or restores an ongoing download.
    function downloadScormPackage() {
        $scope.downloading = true;
        return $mmaModScormPrefetchHandler.download(module, courseid).then(undefined, undefined, function(progress) {

            if (!progress) {
                return;
            }

            if (progress.packageDownload) { // Downloading package.
                if (scorm.packagesize) {
                    $scope.percentage = (parseFloat(progress.loaded / scorm.packagesize) * 100).toFixed(1);
                }
            } else if (progress.message) { // Show a message.
                $scope.progressMessage = progress.message;
                $scope.percentage = undefined;
            } else if (progress.loaded && progress.total) { // Unzipping package.
                $scope.percentage = (parseFloat(progress.loaded / progress.total) * 100).toFixed(1);
            } else {
                $scope.percentage = undefined;
            }

        }).finally(function() {
            $scope.progressMessage = undefined;
            $scope.percentage = undefined;
            $scope.downloading = false;
        });
    }

    // Open a SCORM package.
    function openScorm(scoId) {
        $state.go('site.mod_scorm-player', {
            scorm: scorm,
            mode: $scope.scormOptions.mode,
            newAttempt: !!$scope.scormOptions.newAttempt,
            organizationId: $scope.currentOrganization.identifier,
            scoId: scoId
        });
    }

    // Tries to synchronize the current SCORM.
    function syncScorm(showErrors) {
        return $mmaModScormSync.syncScorm(scorm).then(function(data) {
            if (data) {
                var message = $mmText.buildMessage(data.warnings);
                if (message) {
                    $mmUtil.showErrorModal(message);
                }
            }
        }).catch(function(err) {
            if (showErrors) {
                return showError(err, 'mma.mod_scorm.errorsyncscorm');
            }
            return $q.reject();
        });
    }

    // Fetch the SCORM data.
    fetchScormData().then(function() {
        $mmaModScorm.logView(scorm.id).then(function() {
            $mmCourse.checkModuleCompletion(courseid, module.completionstatus);
        });
    }).finally(function() {
        $scope.scormLoaded = true;
        $scope.refreshIcon = 'ion-refresh';
        $scope.syncIcon = 'ion-loop';
    });

    // Load a organization's TOC.
    $scope.loadOrg = function() {
        loadOrganizationToc($scope.currentOrganization.identifier).catch(function(message) {
            return showError(message);
        });
    };

    $scope.refreshScorm = function(showErrors) {
        if ($scope.scormLoaded) {
            $scope.refreshIcon = 'spinner';
            $scope.syncIcon = 'spinner';
            return refreshData(false, $scope.hasOffline, showErrors).finally(function() {
                $scope.refreshIcon = 'ion-refresh';
                $scope.syncIcon = 'ion-loop';
                $scope.$broadcast('scroll.refreshComplete');
            });
        }
    };

    // Open a SCORM. It will download the SCORM package if it's not downloaded or it has changed.
    // The scoId param indicates the SCO that needs to be loaded when the SCORM is opened. If not defined, load first SCO.
    $scope.open = function(e, scoId) {
        e.preventDefault();
        e.stopPropagation();

        if ($scope.downloading) {
            // Scope is being downloaded, abort.
            return;
        }

        var isOutdated = currentStatus == mmCoreOutdated;

        if (isOutdated || currentStatus == mmCoreNotDownloaded) {
            // SCORM needs to be downloaded.
            $mmaModScormHelper.confirmDownload(scorm, isOutdated).then(function() {
                // Invalidate WS data if SCORM is outdated.
                var promise = isOutdated ? $mmaModScorm.invalidateAllScormData(scorm.id) : $q.when();
                promise.finally(function() {
                    downloadScormPackage().then(function() {
                        // Success downloading, open scorm if user hasn't left the view.
                        if (!$scope.$$destroyed) {
                            openScorm(scoId);
                        }
                    }).catch(function(error) {
                        if (!$scope.$$destroyed) {
                            $mmaModScormHelper.showDownloadError(scorm, error);
                        }
                    });
                });
            });
        } else {
            openScorm(scoId);
        }
    };

    // Confirm and Remove action.
    $scope.removeFiles = function() {
        $mmCourseHelper.confirmAndRemove(module, courseid);
    };

    // Context Menu Prefetch action.
    $scope.prefetch = function() {
        $mmCourseHelper.contextMenuPrefetch($scope, module, courseid);
    };

    // Context Menu Description action.
    $scope.expandDescription = function() {
        $mmText.expandText($translate.instant('mm.core.description'), $scope.description, false, mmaModScormComponent, module.id);
    };

    // Update data when we come back from the player since it's probable that it has changed.
    // We want to skip the first $ionicView.enter event because it's when the view is created.
    var skip = true;
    $scope.$on('$ionicView.enter', function() {
        if (skip) {
            skip = false;
            return;
        }

        $scope.scormOptions.newAttempt = false; // Uncheck new attempt.

        var forwardView = $ionicHistory.forwardView();
        if (forwardView && forwardView.stateName === 'site.mod_scorm-player') {
            $scope.scormLoaded = false;
            $scope.refreshIcon = 'spinner';
            $scope.syncIcon = 'spinner';
            scrollView.scrollTop();
            // Add a delay to make sure the player has started the last writing calls so we can detect conflicts.
            $timeout(function() {
                refreshData(false, true).finally(function() {
                    $scope.scormLoaded = true;
                    $scope.refreshIcon = 'ion-refresh';
                    $scope.syncIcon = 'ion-loop';
                });
            }, 500);
        }
    });

    // Refresh online status when changes.
    onlineObserver = $mmEvents.on(mmCoreEventOnlineStatusChanged, function(online) {
        $scope.isOnline = online;
    });

    // Refresh data if this SCORM is synchronized automatically.
    syncObserver = $mmEvents.on(mmaModScormEventAutomSynced, function(data) {
        if (data && data.siteid == $mmSite.getId() && data.scormid == scorm.id) {
            $scope.scormLoaded = false;
            $scope.refreshIcon = 'spinner';
            $scope.syncIcon = 'spinner';
            scrollView.scrollTop();
            fetchScormData(false, true).finally(function() {
                $scope.scormLoaded = true;
                $scope.refreshIcon = 'ion-refresh';
                $scope.syncIcon = 'ion-loop';
            });
        }
    });

    $scope.$on('$destroy', function() {
        statusObserver && statusObserver.off && statusObserver.off();
        syncObserver && syncObserver.off && syncObserver.off();
        onlineObserver && onlineObserver.off && onlineObserver.off();
    });
});

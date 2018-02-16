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
 * Assign synchronization service.
 *
 * @module mm.addons.mod_assign
 * @ngdoc service
 * @name $mmaModAssignSync
 */
.factory('$mmaModAssignSync', function($log, $mmaModAssign, $mmSite, $mmSitesManager, $q, $mmaModAssignOffline, $mmCourse, $mmUtil,
            $mmApp, $mmEvents, $translate, mmaModAssignSyncTime, $mmSync, mmaModAssignEventAutomSynced, mmaModAssignComponent,
            $mmaModAssignSubmissionDelegate, $mmSyncBlock, $mmLang, $mmGrades) {

    $log = $log.getInstance('$mmaModAssignSync');

    // Inherit self from $mmSync.
    var self = $mmSync.createChild(mmaModAssignComponent, mmaModAssignSyncTime);

    /**
     * Check if an assign has data to synchronize.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignSync#hasDataToSync
     * @param  {Number} assignId Assignment ID.
     * @param  {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}         Promise resolved with boolean: true if has data to sync, false otherwise.
     */
    self.hasDataToSync = function(assignId, siteId) {
        return $mmaModAssignOffline.getAllAssigns(assignId, siteId).then(function(assigns) {
            return !!assigns.length;
        }).catch(function() {
            return false;
        });
    };

    /**
     * Try to synchronize all assignments that need it and haven't been synchronized in a while.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignSync#syncAllAssignments
     * @param {String} [siteId] Site ID to sync. If not defined, sync all sites.
     * @return {Promise}        Promise resolved when the sync is done.
     */
    self.syncAllAssignments = function(siteId) {
        if (!$mmApp.isOnline()) {
            $log.debug('Cannot sync all assignments because device is offline.');
            return $q.reject();
        }

        var promise;
        if (!siteId) {
            // No site ID defined, sync all sites.
            $log.debug('Try to sync assignments in all sites.');
            promise = $mmSitesManager.getSitesIds();
        } else {
            $log.debug('Try to sync assignments in site ' + siteId);
            promise = $q.when([siteId]);
        }

        return promise.then(function(siteIds) {
            var sitePromises = [];

            angular.forEach(siteIds, function(siteId) {
                // Sync submissions.
                sitePromises.push($mmaModAssignOffline.getAllAssigns(siteId).then(function(assignIds) {
                    var promises = [];

                    // Sync all assigns that haven't been synced for a while.
                    angular.forEach(assignIds, function(assignId) {
                        promises.push(self.syncAssignIfNeeded(assignId, siteId).then(function(data) {
                            if (data && data.updated) {
                                // Sync done. Send event.
                                $mmEvents.trigger(mmaModAssignEventAutomSynced, {
                                    siteid: siteId,
                                    assignid: assignId,
                                    warnings: data.warnings
                                });
                            }
                        }));
                    });

                    return $q.all(promises);
                }));
            });

            return $q.all(sitePromises);
        });
    };

    /**
     * Sync an assign only if a certain time has passed since the last time.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignSync#syncAssignIfNeeded
     * @param  {Number} assignId Assignment ID.
     * @param {String} [siteId]      Site ID. If not defined, current site.
     * @return {Promise}             Promise resolved when the assign is synced or if it doesn't need to be synced.
     */
    self.syncAssignIfNeeded = function(assignId, siteId) {
        return self.isSyncNeeded(assignId, siteId).then(function(needed) {
            if (needed) {
                return self.syncAssign(assignId, siteId);
            }
        });
    };

    /**
     * Try to synchronize an assign.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignSync#syncAssign
     * @param  {Number} assignId Assignment ID.
     * @param  {String} [siteId]     Site ID. If not defined, current site.
     * @return {Promise}             Promise resolved if sync is successful, rejected otherwise.
     */
    self.syncAssign = function(assignId, siteId) {
        siteId = siteId || $mmSite.getId();

        var syncPromise,
            syncPromises = [],
            assign,
            courseId,
            result = {
                warnings: [],
                updated: false
            };

        if (self.isSyncing(assignId, siteId)) {
            // There's already a sync ongoing for this discussion, return the promise.
            return self.getOngoingSync(assignId, siteId);
        }

        // Verify that assign isn't blocked.
        if ($mmSyncBlock.isBlocked(mmaModAssignComponent, assignId, siteId)) {
            $log.debug('Cannot sync assign ' + assignId + ' because it is blocked.');
            var modulename = $mmCourse.translateModuleName('assign');
            return $mmLang.translateAndReject('mm.core.errorsyncblocked', {$a: modulename});
        }

        $log.debug('Try to sync assign ' + assignId);

        // Get offline submissions to be sent.
        syncPromises.push($mmaModAssignOffline.getAssignSubmissions(assignId, siteId).catch(function() {
            // No offline data found, return empty array.
            return [];
        }));

        // Get offline submission grades to be sent.
        syncPromises.push($mmaModAssignOffline.getAssignSubmissionsGrade(assignId, siteId).catch(function() {
            // No offline data found, return empty array.
            return [];
        }));

        syncPromise = $q.all(syncPromises).then(function(syncs) {
            var submissions = syncs[0],
                grades = syncs[1];

            if (!submissions.length && !grades.length) {
                // Nothing to sync.
                return;
            } else if (!$mmApp.isOnline()) {
                // Cannot sync in offline.
                return $q.reject();
            }

            courseId = submissions.length > 0 ? submissions[0].courseid : grades[0].courseid;

            return $mmaModAssign.getAssignmentById(courseId, assignId, siteId).then(function(assignData) {
                assign = assignData;

                 var promises = [];

                angular.forEach(submissions, function(submission) {
                    promises.push(syncSubmission(assign, submission, result.warnings, siteId).then(function() {
                        result.updated = true;
                    }));
                });

                angular.forEach(grades, function(grade) {
                    promises.push(syncSubmissionGrade(assign, grade, result.warnings, courseId, siteId).then(function() {
                        result.updated = true;
                    }));
                });

                return $q.all(promises);
            }).then(function() {
                if (result.updated) {
                    // Data has been sent to server. Now invalidate the WS calls.
                    return $mmaModAssign.invalidateContent(assign.cmid, courseId, siteId).catch(function() {
                        // Ignore errors.
                    });
                }
            });
        }).then(function() {
            // Sync finished, set sync time.
            return self.setSyncTime(assignId, siteId).catch(function() {
                // Ignore errors.
            });
        }).then(function() {
            // All done, return the warnings.
            return result;
        });

        return self.addOngoingSync(assignId, syncPromise, siteId);
    };

    /**
     * Synchronize a submission.
     *
     * @param  {Object} assign      Assignment.
     * @param  {Object} offlineData Submission offline data.
     * @param  {Object[]} warnings  List of warnings.
     * @param  {String} [siteId]    Site ID. If not defined, current site.
     * @return {Promise}            Promise resolved if success, rejected otherwise.
     */
    function syncSubmission(assign, offlineData, warnings, siteId) {
        var discardError,
            userId = offlineData.userid,
            submission,
            pluginData = {};

        return $mmaModAssign.getSubmissionStatus(assign.id, userId, false, true, true, siteId).then(function(status) {
            var promises = [];

            submission = $mmaModAssign.getSubmissionObjectFromAttempt(assign, status.lastattempt);

            if (submission.timemodified != offlineData.onlinetimemodified) {
                // The submission was modified in Moodle, discard the submission.
                discardError = $translate.instant('mma.mod_assign.warningsubmissionmodified');
                return;
            }

            angular.forEach(submission.plugins, function(plugin) {
                promises.push($mmaModAssignSubmissionDelegate.preparePluginSyncData(
                        assign, submission, plugin, offlineData, pluginData, siteId));
            });

            return $q.all(promises).then(function() {
                // Now save the submission.
                var promise;

                if (!Object.keys(pluginData).length) {
                    promise = $q.when();
                } else {
                    promise = $mmaModAssign.saveSubmissionOnline(assign.id, pluginData, siteId);
                }

                return promise.then(function() {
                    if (assign.submissiondrafts && offlineData.submitted) {
                        // The user submitted the assign manually. Submit it for grading.
                        return $mmaModAssign.submitForGradingOnline(assign.id, offlineData.submissionstatement, siteId);
                    }
                }).then(function() {
                    // Submission data sent, update cached data. No need to block the user for this.
                    $mmaModAssign.getSubmissionStatus(assign.id, userId, false, true, true, siteId);
                }).catch(function(error) {
                    if (error && error.wserror) {
                        // The WebService has thrown an error, this means it cannot be submitted. Discard the submission.
                        discardError = error.error;
                    } else {
                        // Couldn't connect to server, reject.
                        return $q.reject(error && error.error);
                    }
                });
            }, function(error) {
                if ($mmUtil.isWebServiceError(error)) {
                    discardError = error;
                } else {
                    return $q.reject(error);
                }
            });
        }).then(function() {
            // Delete the offline data.
            return $mmaModAssignOffline.deleteSubmission(assign.id, userId, siteId).then(function() {
                var promises = [];

                angular.forEach(submission.plugins, function(plugin) {
                    promises.push($mmaModAssignSubmissionDelegate.deletePluginOfflineData(
                        assign, submission, plugin, offlineData, siteId));
                });

                return $q.all(promises);
            });
        }).then(function() {
            if (discardError) {
                // Submission was discarded, add a warning.
                var message = $translate.instant('mm.core.warningofflinedatadeleted', {
                    component: $mmCourse.translateModuleName('assign'),
                    name: assign.name,
                    error: discardError
                });

                if (warnings.indexOf(message) == -1) {
                    warnings.push(message);
                }
            }
        });
    }

    // Convenience function to get scale selected option.
    function getSelectedScaleId(options, selected) {
        options = options.split(",");
        options = options.map(function (value) {return value.trim();});
        options.unshift("");

        var index = options.indexOf(selected) || 0;
        if (index < 0) {
            return 0;
        }
        return index;
    }

    /**
     * Synchronize a submission grade.
     *
     * @param  {Object}   assign        Assignment.
     * @param  {Object}   offlineData   Submission grade offline data.
     * @param  {Object[]} warnings      List of warnings.
     * @param  {Number}   courseId      Course Id.
     * @param  {String}   [siteId]      Site ID. If not defined, current site.
     * @return {Promise}            Promise resolved if success, rejected otherwise.
     */
    function syncSubmissionGrade(assign, offlineData, warnings, courseId, siteId) {
        var discardError,
            userId = offlineData.userid;

        return $mmaModAssign.getSubmissionStatus(assign.id, userId, false, true, true, siteId).then(function(status) {
            var timemodified = status.feedback && (status.feedback.gradeddate || (status.feedback.grade.timemodified));

            if (timemodified > offlineData.timemodified) {
                // The submission grade was modified in Moodle, discard it.
                discardError = $translate.instant('mma.mod_assign.warningsubmissiongrademodified');
                return;
            }

            // If grade has been modified from gradebook, do not use offline.
            return $mmGrades.getGradeModuleItems(courseId, assign.cmid, userId, false, siteId, true).then(function(grades) {
                return $mmCourse.getModuleBasicGradeInfo(assign.cmid, siteId).then(function(gradeInfo) {
                    angular.forEach(grades, function(grade) {
                        if (grade.gradedategraded >= offlineData.timemodified) {
                            if (!grade.outcomeid && !grade.scaleid) {
                                if (scope.grade.scale && gradeInfo && gradeInfo.scale) {
                                    offlineData.grade = getSelectedScaleId(gradeInfo.scale, grade.gradeformatted);
                                } else if (!scope.grade.scale) {
                                    offlineData.grade = parseFloat(grade.gradeformatted) || null;
                                }
                            } else if (grade.outcomeid && $mmaModAssign.isOutcomesEditEnabled() && gradeInfo.outcomes) {
                                angular.forEach(gradeInfo.outcomes, function(outcome, itemNumber) {
                                    if (outcome.scale && grade.itemnumber == itemNumber) {
                                        offlineData.outcomes[grade.itemnumber] = getSelectedScaleId(outcome.scale, outcome.selected);
                                    }
                                });
                            }
                        }
                    });
                });
            }).then(function() {
                return $mmaModAssign.submitGradingFormOnline(assign.id, userId, offlineData.grade, offlineData.attemptnumber,
                        offlineData.addattempt, offlineData.workflowstate, offlineData.applytoall, offlineData.outcomes,
                        offlineData.plugindata, siteId).then(function() {
                    // Grades sent, update cached data. No need to block the user for this.
                    $mmaModAssign.getSubmissionStatus(assign.id, userId, false, true, true, siteId);
                }).catch(function(error) {
                    if (error && error.wserror) {
                        // The WebService has thrown an error, this means it cannot be submitted. Discard the offline data.
                        discardError = error.error;
                    } else {
                        // Couldn't connect to server, reject.
                        return $q.reject(error && error.error);
                    }
                });
            });
        }).then(function() {
            // Delete the offline data.
            return $mmaModAssignOffline.deleteSubmissionGrade(assign.id, userId, siteId);
        }).then(function() {
            if (discardError) {
                // Submission grade was discarded, add a warning.
                var message = $translate.instant('mm.core.warningofflinedatadeleted', {
                    component: $mmCourse.translateModuleName('assign'),
                    name: assign.name,
                    error: discardError
                });

                if (warnings.indexOf(message) == -1) {
                    warnings.push(message);
                }
            }
        });
    }

    return self;
});

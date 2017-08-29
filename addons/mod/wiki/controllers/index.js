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

angular.module('mm.addons.mod_wiki')

/**
 * Wiki index controller.
 *
 * @module mm.addons.mod_wiki
 * @ngdoc controller
 * @name mmaModWikiIndexCtrl
 */
.controller('mmaModWikiIndexCtrl', function($q, $scope, $stateParams, $mmCourse, $mmUser, $mmGroups, $ionicPopover, $mmUtil, $state,
        $mmSite, $mmaModWiki, $ionicTabsDelegate, $ionicHistory, $translate, mmaModWikiSubwikiPagesLoaded, $mmCourseHelper,
        $mmText, mmaModWikiComponent, $mmEvents, $ionicScrollDelegate,
        $mmaModWikiOffline, mmaModWikiPageCreatedEvent, mmaModWikiSubwikiAutomSyncedEvent, $mmaModWikiSync,
        mmaModWikiManualSyncedEvent, $mmApp, mmCoreEventOnlineStatusChanged) {
    var module = $stateParams.module || {},
        courseId = $stateParams.courseid,
        action = $stateParams.action || 'page',
        currentPage = $stateParams.pageid || false,
        pageTitle = $stateParams.pagetitle,
        isCurrentView = true,
        popover, wiki, currentSubwiki, loadedSubwikis, tabsDelegate, onlineObserver,
        currentPageObj, newPageObserver, syncObserver, syncObserverManual, scrollView, ignoreManualSyncEvent;

    $scope.title = pageTitle || module.name;
    $scope.description = module.description;
    $scope.mainpage = !currentPage && !pageTitle;
    $scope.moduleUrl = module.url;
    $scope.courseId = courseId;
    $scope.component = mmaModWikiComponent;
    $scope.canEdit = false;
    $scope.subwikiData = {
        subwikiSelected: 0,
        userSelected: 0,
        groupSelected: 0,
        subwikis: [],
        count: 0
    };
    $scope.refreshIcon = 'spinner';
    $scope.syncIcon = 'spinner';
    $scope.pageStr = $translate.instant('mma.mod_wiki.page');
    $scope.moduleName = $mmCourse.translateModuleName('wiki');

    $scope.tabsDelegateName = 'mmaModWikiTabs_'+(module.id || 0) + '_' + (currentPage || 0) + '_' +  new Date().getTime();
    tabsDelegate = $ionicTabsDelegate.$getByHandle($scope.tabsDelegateName);

    $scope.showSubwikiPicker = function(e) {
        popover.show(e);
    };

    $scope.goHomeWiki = function(e) {
        var backTimes = getHistoryBackCounter();
        // Go back X times until the wiki home.
        $ionicHistory.goBack(backTimes);
    };

    $scope.gotoPage = function(page) {
        if (!page.id) {
            // It's an offline page. Check if we are already in the same offline page.
            if (currentPage || !pageTitle || page.title != pageTitle) {
                var stateParams = {
                    module: module,
                    moduleid: module.id,
                    courseid: courseId,
                    pagetitle: page.title,
                    pageid: null,
                    wikiid: wiki.id,
                    subwikiid: page.subwikiid,
                    action: 'page'
                };
                return $state.go('site.mod_wiki', stateParams);
            }
        } else if (currentPage != page.id) {
            // Add a new State.
            return fetchPageContents(page.id).then(function(page) {
                var stateParams = {
                    module: module,
                    moduleid: module.id,
                    courseid: courseId,
                    pageid: page.id,
                    pagetitle: page.title,
                    wikiid: page.wikiid,
                    subwikiid: page.subwikiid,
                    action: 'page'
                };
                return $state.go('site.mod_wiki', stateParams);
            });
        }

        // No changes done.
        tabsDelegate.select(0);
    };

    $scope.gotoEditPage = function() {
        if (!$scope.canEdit) {
            return;
        }
        if (currentPageObj) {
            var stateParams = {
                module: module,
                moduleid: module.id,
                courseid: courseId,
                pageid: currentPageObj.id,
                pagetitle: currentPageObj.title,
                subwikiid: currentPageObj.subwikiid
            };
            if (currentSubwiki) {
                stateParams.wikiid = currentSubwiki.wikiid;
                stateParams.userid = currentSubwiki.userid;
                stateParams.groupid = currentSubwiki.groupid;
            }

            return $state.go('site.mod_wiki-edit', stateParams);
        } else if (currentSubwiki) {
            return gotoCreateFirstPage();
        }
    };

    $scope.gotoNewPage = function() {
        if (!$scope.canEdit) {
            return;
        }
        if (currentPageObj) {
            var stateParams = {
                module: module,
                moduleid: module.id,
                courseid: courseId,
                subwikiid: currentPageObj.subwikiid
            };
            if (currentSubwiki) {
                stateParams.wikiid = currentSubwiki.wikiid;
                stateParams.userid = currentSubwiki.userid;
                stateParams.groupid = currentSubwiki.groupid;
            }

            return $state.go('site.mod_wiki-edit', stateParams);
        } else if (currentSubwiki) {
            return gotoCreateFirstPage();
        }
    };

    // First page is missing. It will go to create the page.
    function gotoCreateFirstPage() {
        var stateParams = {
            module: module,
            moduleid: module.id,
            courseid: courseId,
            pagetitle: wiki.firstpagetitle,
            wikiid: currentSubwiki.wikiid,
            userid: currentSubwiki.userid,
            groupid: currentSubwiki.groupid
        };

        return $state.go('site.mod_wiki-edit', stateParams);
    }

    $scope.gotoSubwiki = function(subwikiId, userId, groupId, canEdit) {

        // Check if the subwiki is disabled.
        if (subwikiId > 0 || canEdit) {
            popover.hide();

            if (subwikiId != currentSubwiki.id || userId != currentSubwiki.userid || groupId != currentSubwiki.groupid) {
                // Add a new State.
                var stateParams = {
                    module: module,
                    moduleid: module.id,
                    courseid: courseId,
                    pageid: null,
                    pagetitle: null,
                    wikiid: wiki.id,
                    subwikiid: subwikiId,
                    userid: userId,
                    groupid: groupId,
                    action: tabsDelegate.selectedIndex() == 0 ? 'page' : 'map'
                };
                return $state.go('site.mod_wiki', stateParams);
            }
        }
    };

    // Convenience function to get wiki data.
    function fetchWikiData(refresh, sync, showErrors) {
        $scope.isOnline = $mmApp.isOnline();

        var id = module.id || $stateParams.wikiid,
            paramName = module.id ? 'coursemodule' : 'id';

        return $mmaModWiki.getWiki(courseId, id, paramName).then(function(wikiData) {
            wiki = wikiData;
            $scope.wiki = wiki;

            if (sync) {
                // Try to synchronize the wiki.
                return syncWiki(showErrors).catch(function() {
                    // Ignore errors.
                });
            }
        }).then(function() {

            if ($scope.pageWarning) {
                // Page discarded, stop getting data.
                return $q.reject();
            }

            var promise;
            if (isCurrentView) {
                $scope.showHomeButton = getHistoryBackCounter() < 0;
            }

            // Get module url if not defined.
            if (!module.url) {
                promise = $mmCourse.getModule(wiki.coursemodule, wiki.course, null, true);
            } else {
                // This is done to ensure stateparams.module.instance is available when wikiid is not (needed in home button).
                // This is done only for older Moodle versions that does not send module.instance see MDL-48357.
                module.instance = wiki.id;
                promise = $q.when(module);
            }

            return promise.then(function(mod) {
                module = mod;

                $scope.title = $scope.title || wiki.title;
                $scope.description = wiki.intro || module.description;
                $scope.moduleUrl = module.url;
                $scope.componentId = module.id;

                // Get real groupmode, in case it's forced by the course.
                return $mmGroups.getActivityGroupMode(wiki.coursemodule).then(function(groupmode) {

                    if (groupmode === $mmGroups.SEPARATEGROUPS || groupmode === $mmGroups.VISIBLEGROUPS) {
                        // Get the groups available for the user.
                        promise = $mmGroups.getActivityAllowedGroups(wiki.coursemodule);
                    } else {
                        promise = $q.when([]);
                    }

                    return promise.then(function(userGroups) {
                        return fetchSubwikis(wiki.id).then(function() {
                            var subwikiList = $mmaModWiki.getSubwikiList(wiki.id);

                            if (!subwikiList) {
                                return createSubwikiList(userGroups);
                            }

                            $scope.subwikiData.count = subwikiList.count;
                            setSelectedWiki($stateParams.subwikiid, $stateParams.userid, $stateParams.groupid);
                            // If anything was selected using stateparams, set the selected on cache.
                            if (!isAnySubwikiSelected()) {
                                setSelectedWiki(subwikiList.subwikiSelected, subwikiList.userSelected, subwikiList.groupSelected);
                            }

                            $scope.subwikiData.subwikis = subwikiList.subwikis;
                            return $q.when();
                        });
                    }).then(function() {

                        if ($scope.subwikiData.count > 1) {
                            // More than one subwiki available.
                            handleSubwikiPopover();
                        }

                        if (!refresh) {
                            tabsDelegate.select(action == 'map' ? 1 : 0);
                        }

                        if (!isAnySubwikiSelected() || $scope.subwikiData.count <= 0) {
                            return $q.reject($translate.instant('mma.mod_wiki.errornowikiavailable'));
                        }
                    }).then(function() {
                        return fetchWikiPage();
                    }).then(function() {
                        // All data obtained, now fill the context menu.
                        $mmCourseHelper.fillContextMenu($scope, module, courseId, refresh, mmaModWikiComponent);
                    });
                });
            });
        }).catch(function(message) {
            if ($scope.pageWarning) {
                // Warning is already shown in screen, no need to show a modal.
                return $q.reject();
            }

            if (!refresh && !wiki) {
                // Some call failed, retry without using cache since it might be a new activity.
                return refreshAllData(sync, showErrors);
            }

            $mmUtil.showErrorModalDefault(message, 'Error getting wiki data.');
            return $q.reject();
        });
    }

    // Context Menu Description action.
    $scope.expandDescription = function() {
        $mmText.expandText($translate.instant('mm.core.description'), $scope.description, false, mmaModWikiComponent, module.id);
    };

    // Confirm and Remove action.
    $scope.removeFiles = function() {
        $mmCourseHelper.confirmAndRemove(module, courseId);
    };

    // Context Menu Prefetch action.
    $scope.prefetch = function() {
        $mmCourseHelper.contextMenuPrefetch($scope, module, courseId);
    };
    // Convinience function that handles Subwiki Popover.
    function handleSubwikiPopover() {
        $ionicPopover.fromTemplateUrl('addons/mod/wiki/templates/subwiki_picker.html', {
            scope: $scope
        }).then(function(po) {
            popover = po;
        });
    }


    // Create the Subwiki List for the selector
    function createSubwikiList(userGroups) {
        var subwikiList = [],
            promises = [],
            userGroupsIds = [],
            allParticipants = false,
            showMyGroupsLabel = false,
            multiLevelList = false,
            currentUserId = $mmSite.getUserId() || false,
            allParticipantsTitle = $translate.instant('mm.core.allparticipants'),
            nonInGroupTitle = $translate.instant('mma.mod_wiki.notingroup'),
            myGroupsTitle = $translate.instant('mm.core.mygroups'),
            otherGroupsTitle = $translate.instant('mm.core.othergroups');

        $scope.subwikiData.subwikis = [];
        setSelectedWiki($stateParams.subwikiid, $stateParams.userid, $stateParams.groupid);
        $scope.subwikiData.count = 0;

        // Group mode available.
        if (userGroups.length > 0) {
            userGroupsIds = userGroups.map(function(g) {
                return g.id;
            });
        }

        angular.forEach(loadedSubwikis, function(subwiki) {
            var groupIdx,
                promise,
                groupId = parseInt(subwiki.groupid, 10),
                groupLabel = "",
                userId = parseInt(subwiki.userid, 10);

            if (groupId == 0 && userId == 0) {
                // Add 'All participants' subwiki if needed at the start.
                if (!allParticipants) {
                    subwikiList.unshift({
                        name: allParticipantsTitle,
                        id: subwiki.id,
                        user: userId,
                        group: groupId,
                        groupLabel: "",
                        canedit: subwiki.canedit
                    });
                    allParticipants = true;
                }
            } else {
                if (groupId != 0 && userGroupsIds.length > 0) {
                    // Get groupLabel if it has groupId.
                    groupIdx = userGroupsIds.indexOf(groupId);
                    if (groupIdx > -1) {
                        groupLabel = userGroups[groupIdx].name;
                    }
                } else {
                    groupLabel = nonInGroupTitle;
                }

                if (userId != 0) {
                    // Get user if it has userid.
                    promise = $mmUser.getProfile(userId, null, true).then(function(user) {
                        subwikiList.push({
                            name: user.fullname,
                            id: subwiki.id,
                            user: userId,
                            group: groupId,
                            groupLabel: groupLabel,
                            canedit: subwiki.canedit
                        });

                    });
                    promises.push(promise);

                    if (!multiLevelList && groupId != 0) {
                        multiLevelList = true;
                    }
                } else {
                    subwikiList.push({
                        name: groupLabel,
                        id: subwiki.id,
                        user: userId,
                        group: groupId,
                        groupLabel: groupLabel,
                        canedit: subwiki.canedit
                    });
                    showMyGroupsLabel = true;
                }
            }
        });

        return $q.all(promises).then(function() {
            var groupValue = -1,
                grouping;

            subwikiList.sort(function(a, b) {
                return a.group - b.group;
            });

            $scope.subwikiData.count = subwikiList.length;

            // If no subwiki is received as view param, select always the most propper.
            if ((!$stateParams.subwikiid || (!$stateParams.userid && !$stateParams.groupid)) && !isAnySubwikiSelected() &&
                    subwikiList.length > 0) {
                var firstCanEdit = false;
                    candidateNoFirstPage = false,
                    candidateFirstPage = false;
                for (var x in subwikiList) {
                    var subwiki = subwikiList[x];
                    if (subwiki.canedit) {
                        var candidateSubwikiId = false;
                        if (subwiki.user > 0) {
                            // Check if it's the current user.
                            if (currentUserId == subwiki.user) {
                                candidateSubwikiId = subwiki.id;
                            }
                        } else if (subwiki.group > 0) {
                            // Check if it's a current user' group.
                            if (showMyGroupsLabel) {
                                candidateSubwikiId = subwiki.id;
                            }
                        } else if (subwiki.id > 0) {
                            candidateSubwikiId = subwiki.id;
                        }

                        if (candidateSubwikiId !== false) {
                            if (candidateSubwikiId > 0) {
                                // Subwiki found and created, no need to keep looking.
                                candidateFirstPage = x;
                                break;
                            } else if (candidateNoFirstPage === false) {
                                candidateNoFirstPage = x;
                            }
                        } else if (firstCanEdit === false) {
                            firstCanEdit = x;
                        }
                    }
                }

                var subWikiToTake;
                if (candidateFirstPage !== false) {
                    // Take the candidate that already has the first page created.
                    subWikiToTake = candidateFirstPage;
                } else if (candidateNoFirstPage !== false) {
                    // No first page created, take the first candidate.
                    subWikiToTake = candidateNoFirstPage;
                } else if (firstCanEdit !== false) {
                    // None selected, take the first the user can edit.
                    subWikiToTake = firstCanEdit;
                } else {
                    // Otherwise take the very first.
                    subWikiToTake = 0;
                }

                if (typeof subwikiList[subWikiToTake] != "undefined") {
                    setSelectedWiki(subwikiList[subWikiToTake].id, subwikiList[subWikiToTake].user,
                        subwikiList[subWikiToTake].group);
                }
            }

            if (multiLevelList) {
                // As we loop over each subwiki, add it to the current group
                for (var i in subwikiList) {
                    var subwiki = subwikiList[i];

                    // Should we create a new grouping?
                    if (subwiki.group !== groupValue) {
                        grouping = {label: subwiki.groupLabel, subwikis: []};
                        groupValue = subwiki.group;

                        $scope.subwikiData.subwikis.push(grouping);
                    }

                    // Add the subwiki to the currently active grouping.
                    grouping.subwikis.push(subwiki);
                }
            } else if (showMyGroupsLabel) {
                var noGrouping = {label: "", subwikis: []},
                    myGroupsGrouping = {label: myGroupsTitle, subwikis: []},
                    otherGroupsGrouping = {label: otherGroupsTitle, subwikis: []};

                // As we loop over each subwiki, add it to the current group
                for (var i in subwikiList) {
                    var subwiki = subwikiList[i];

                    // Add the subwiki to the currently active grouping.
                    if (typeof subwiki.canedit == 'undefined') {
                        noGrouping.subwikis.push(subwiki);
                    } else if (subwiki.canedit) {
                        myGroupsGrouping.subwikis.push(subwiki);
                    } else {
                        otherGroupsGrouping.subwikis.push(subwiki);
                    }
                }

                // Add each grouping to the subwikis
                if (noGrouping.subwikis.length > 0) {
                    $scope.subwikiData.subwikis.push(noGrouping);
                }
                if (myGroupsGrouping.subwikis.length > 0) {
                    $scope.subwikiData.subwikis.push(myGroupsGrouping);
                }
                if (otherGroupsGrouping.subwikis.length > 0) {
                    $scope.subwikiData.subwikis.push(otherGroupsGrouping);
                }
            } else {
                $scope.subwikiData.subwikis.push({label: "", subwikis: subwikiList});
            }

            $mmaModWiki.setSubwikiList(wiki.id, $scope.subwikiData.subwikis, $scope.subwikiData.count,
                $scope.subwikiData.subwikiSelected, $scope.subwikiData.userSelected, $scope.subwikiData.groupSelected);
        });
    }

    // Get number of steps to get the first page of the wiki in the history
    function getHistoryBackCounter() {
        var view, historyInstance, backTimes = 0,
            backViewId = $ionicHistory.currentView().backViewId;

        if (!wiki.id) {
            return 0;
        }

        while (backViewId) {
            view = $ionicHistory.viewHistory().views[backViewId];

            if (view.stateName != 'site.mod_wiki') {
                break;
            }

            historyInstance = view.stateParams.wikiid ? view.stateParams.wikiid : view.stateParams.module.instance;

            // Check we are not changing to another Wiki.
            if (historyInstance && historyInstance == wiki.id) {
                backTimes--;
            } else {
                break;
            }

            backViewId = view.backViewId;
        }

        return backTimes;
    }

    // Convenience function to get wiki options.
    function fetchSubwikis(wikiId) {
        return $mmaModWiki.getSubwikis(wikiId).then(function(subwikis) {
            loadedSubwikis = subwikis;

            return $mmaModWikiOffline.subwikisHaveOfflineData(subwikis).then(function(hasOffline) {
                $scope.wikiHasOffline = hasOffline;
            });
        });
    }

    // Fetch the page to be shown.
    function fetchWikiPage() {
        // Search the current Subwiki.
        currentSubwiki = false;
        for (var x in loadedSubwikis) {
            if ($scope.isSubwikiSelected(loadedSubwikis[x])) {
                currentSubwiki = loadedSubwikis[x];
                break;
            }
        }

        if (!currentSubwiki) {
            return $q.reject();
        }

        setSelectedWiki(currentSubwiki.id, currentSubwiki.userid, currentSubwiki.groupid);

        // We need fetchSubwikis to finish before calling fetchSubwikiPages because it needs subwikiid and pageid variable.
        return fetchSubwikiPages(currentSubwiki).then(function() {
            // Check can edit before to have the value if there's no valid page.
            $scope.canEdit = currentSubwiki.canedit && $mmaModWiki.isPluginEnabledForEditing();

            return fetchPageContents(currentPage).then(function(pageContents) {
                if (pageContents) {
                    $scope.title = pageContents.title;
                    setSelectedWiki(pageContents.subwikiid, pageContents.userid, pageContents.groupid);

                    $scope.pageContent = replaceEditLinks(pageContents.cachedcontent);
                    $scope.canEdit = pageContents.caneditpage && $mmaModWiki.isPluginEnabledForEditing();
                    currentPageObj = pageContents;
                }
            });
        });
    }

    // Replace edit links to have full url.
    function replaceEditLinks(content) {
        content = content.trim();
        if (content.length > 0) {
            var url = $mmSite.getURL();
            content = content.replace(/href="edit\.php/g, 'href="'+url+'/mod/wiki/edit.php');
        }
        return content;
    }

    // Convenience function to get wiki subwikiPages.
    function fetchSubwikiPages(subwiki) {
        return $mmaModWiki.getSubwikiPages(subwiki.wikiid, subwiki.groupid, subwiki.userid).then(function(subwikiPages) {

            // If no page specified, search first page.
            if (!currentPage && !pageTitle) {
                angular.forEach(subwikiPages, function(subwikiPage) {
                    if (!currentPage && subwikiPage.firstpage) {
                        currentPage = subwikiPage.id;
                    }
                });
            }

            // Now get the offline pages.
            return $mmaModWikiOffline.getSubwikiNewPages(subwiki.id, subwiki.wikiid, subwiki.userid, subwiki.groupid)
                    .then(function(offlinePages) {

                // If no page specified, search page title in the offline pages.
                if (!currentPage) {
                    var searchTitle = pageTitle ? pageTitle : wiki.firstpagetitle;
                    angular.forEach(offlinePages, function(subwikiPage) {
                        if (!currentPage && subwikiPage.title == searchTitle) {
                            pageTitle = subwikiPage.title;
                        }
                    });
                }

                $scope.subwikiPages = $mmaModWiki.sortPagesByTitle(subwikiPages.concat(offlinePages));
                $scope.$broadcast(mmaModWikiSubwikiPagesLoaded, $scope.subwikiPages);

                // Reject if no currentPage selected from the subwikis given (if no subwikis avalaible, do not reject).
                if (!currentPage && !pageTitle && subwikiPages.length > 0) {
                    return $q.reject();
                }
            });
        });
    }

    // Convenience function to get wiki page contents.
    function fetchPageContents(pageId) {
        if (!pageId) {
            var title = pageTitle || wiki.firstpagetitle;

            // No page ID but we received a title. This means we're trying to load an offline page.
            return $mmaModWikiOffline.getNewPage(title, currentSubwiki.id, currentSubwiki.wikiid, currentSubwiki.userid,
                    currentSubwiki.groupid).then(function(offlinePage) {
                $scope.pageIsOffline = true;
                if (!newPageObserver) {
                    // It's an offline page, listen for new pages event to detect if the user goes to Edit and submits the page.
                    newPageObserver = $mmEvents.on(mmaModWikiPageCreatedEvent, function(data) {
                        if (data.siteid == $mmSite.getId() && data.subwikiid == currentSubwiki.id && data.pagetitle == title) {
                            // The page has been submitted. Get the page from the server.
                            currentPage = data.pageid;

                            showSpinnerAndFetch(false, true).then(function() {
                                $mmaModWiki.logPageView(currentPage);
                            });

                            // Stop listening for new page events.
                            newPageObserver.off && newPageObserver.off();
                            newPageObserver = false;
                        }
                    });
                }

                return offlinePage;
            }).catch(function() {
                // Page not found, ignore.
            });
        }

        $scope.pageIsOffline = false;
        return $mmaModWiki.getPageContents(pageId);
    }

    // Convenience function to refresh all the data.
    function refreshAllData(sync, showErrors) {
        var promises = [$mmaModWiki.invalidateWikiData(courseId)];
        if (wiki) {
            promises.push($mmaModWiki.invalidateSubwikis(wiki.id));
            promises.push($mmGroups.invalidateActivityAllowedGroups(wiki.coursemodule));
            promises.push($mmGroups.invalidateActivityGroupMode(wiki.coursemodule));
        }
        if (currentSubwiki) {
            promises.push($mmaModWiki.invalidateSubwikiPages(currentSubwiki.wikiid));
            promises.push($mmaModWiki.invalidateSubwikiFiles(currentSubwiki.wikiid));
        }
        if (currentPage) {
            promises.push($mmaModWiki.invalidatePage(currentPage));
        }

        return $q.all(promises).finally(function() {
            return fetchWikiData(true, sync, showErrors);
        });
    }

    // Show spinner and fetch or refresh the data.
    function showSpinnerAndFetch(refresh, sync, showErrors) {
        var promise;

        $scope.wikiLoaded = false;
        $scope.refreshIcon = 'spinner';
        $scope.syncIcon = 'spinner';
        scrollTop();

        promise = refresh ? refreshAllData(sync, showErrors) : fetchWikiData(true, sync, showErrors);

        return promise.finally(function() {
            $scope.wikiLoaded = true;
            $scope.refreshIcon = 'ion-refresh';
            $scope.syncIcon = 'ion-loop';
        });
    }

    function scrollTop() {
        if (!scrollView) {
            scrollView = $ionicScrollDelegate.$getByHandle('mmaModWikiIndexScroll');
        }
        scrollView && scrollView.scrollTop && scrollView.scrollTop();
    }

    fetchWikiData(false, true, false).then(function() {
        if (!currentPage && !pageTitle) {
            $mmaModWiki.logView(wiki.id).then(function() {
                $mmCourse.checkModuleCompletion(courseId, module.completionstatus);
            });
        } else if (currentPage) {
            $mmaModWiki.logPageView(currentPage);
        }
    }).finally(function() {
        $scope.wikiLoaded = true;
        $scope.refreshIcon = 'ion-refresh';
        $scope.syncIcon = 'ion-loop';
    });

    // Pull to refresh.
    $scope.refreshWiki = function(showErrors) {
        if ($scope.wikiLoaded) {
            $scope.refreshIcon = 'spinner';
            $scope.syncIcon = 'spinner';
            return refreshAllData(true, showErrors).finally(function() {
                $scope.refreshIcon = 'ion-refresh';
                $scope.syncIcon = 'ion-loop';
                $scope.$broadcast('scroll.refreshComplete');
            });
        }
    };

    // Tries to synchronize the wiki.
    function syncWiki(showErrors) {
        return $mmaModWikiSync.syncWiki(wiki.id, courseId, wiki.coursemodule).then(function(result) {
            result.wikiid = wiki.id;

            if (result.updated) {
                // Trigger event.
                ignoreManualSyncEvent = true;
                $mmEvents.trigger(mmaModWikiManualSyncedEvent, result);
            }

            if (result.warnings && result.warnings.length) {
                $mmUtil.showErrorModal($mmText.buildMessage(result.warnings));
            }

            if (currentSubwiki) {
                checkPageCreatedOrDiscarded(result.subwikis[currentSubwiki.id]);
            }

            return result.updated;
        }).catch(function(error) {
            if (showErrors) {
                $mmUtil.showErrorModalDefault(error, 'mm.core.errorsync', true);
            }
            return $q.reject();
        });
    }

    // Check if the current page was created or discarded.
    function checkPageCreatedOrDiscarded(data) {
        if (!currentPage && data) {
            // This is an offline page. Check if the page was created.
            var page,
                pageId;

            for (var i = 0, len = data.created.length; i < len; i++) {
                page = data.created[i];
                if (page.title == pageTitle) {
                    pageId = page.pageid;
                    break;
                }
            }

            if (pageId) {
                // Page was created, set the ID so it's retrieved from server.
                currentPage = pageId;
            } else {
                // Page not found, check if it was discarded.
                for (i = 0, len = data.discarded.length; i < len; i++) {
                    page = data.discarded[i];
                    if (page.title == pageTitle) {
                        // Page discarded, show warning.
                        $scope.pageWarning = page.warning;
                        $scope.pageContent = '';
                        $scope.pageIsOffline = false;
                        $scope.wikiHasOffline = false;
                    }
                }
            }
        }
    }

    // Update data when we come back from the view since it's probable that it has changed.
    // We want to skip the first $ionicView.enter event because it's when the view is created.
    var skip = true;
    $scope.$on('$ionicView.enter', function() {
        isCurrentView = true;

        if (skip) {
            skip = false;
            return;
        }

        var forwardView = $ionicHistory.forwardView();
        if (forwardView && forwardView.stateName === 'site.mod_wiki-edit') {
            showSpinnerAndFetch(false, true);
        }
    });

    // Update isCurrentView when leaving the view.
    $scope.$on('$ionicView.beforeLeave', function() {
        isCurrentView = false;
    });

    // Refresh online status when changes.
    onlineObserver = $mmEvents.on(mmCoreEventOnlineStatusChanged, function(online) {
        $scope.isOnline = online;
    });

    // Refresh data if this subwiki is synchronized automatically.
    syncObserver = $mmEvents.on(mmaModWikiSubwikiAutomSyncedEvent, function(data) {
        if (data && currentSubwiki && data.siteid == $mmSite.getId() && data.subwikiid == currentSubwiki.id &&
                data.wikiid == currentSubwiki.wikiid && data.userid == currentSubwiki.userid  &&
                data.groupid == currentSubwiki.groupid) {
            if (isCurrentView && data.warnings && data.warnings.length) {
                // Show warnings.
                $mmUtil.showErrorModal($mmText.buildMessage(data.warnings));
            }

            // Check if current page was created or discarded.
            checkPageCreatedOrDiscarded(data);

            if (!$scope.pageWarning) {
                showSpinnerAndFetch(true, false);
            }
        }
    });

    // Refresh data if this wiki is synchronized manually.
    syncObserverManual = $mmEvents.on(mmaModWikiManualSyncedEvent, function(data) {
        if (data && wiki && data.siteid == $mmSite.getId() && data.wikiid == wiki.id) {
            if (ignoreManualSyncEvent) {
                ignoreManualSyncEvent = false;
                return;
            }

            if (currentSubwiki) {
                checkPageCreatedOrDiscarded(data.subwikis[currentSubwiki.id]);
            }

            if (!$scope.pageWarning) {
                showSpinnerAndFetch(false, false);
            }
        }
    });

    // Sets the selected subwiki for the subwiki picker.
    function setSelectedWiki(subwiki, user, group) {
        $scope.subwikiData.subwikiSelected = (subwiki = parseInt(subwiki, 10)) > 0 ? subwiki : 0;
        $scope.subwikiData.userSelected = parseInt(user, 10) || 0;
        $scope.subwikiData.groupSelected = parseInt(group, 10) || 0;
    }

    // Checks if the given subwiki is the one picked on the subwiki picker.
    $scope.isSubwikiSelected = function(subwiki) {
        var subwikiId = parseInt(subwiki.id, 10) || 0;
        if (subwikiId > 0 && $scope.subwikiData.subwikiSelected > 0) {
            return subwikiId == $scope.subwikiData.subwikiSelected;
        }

        var userId = parseInt(subwiki.user, 10) || parseInt(subwiki.userid, 10) || 0,
            groupId = parseInt(subwiki.group, 10) || parseInt(subwiki.groupid, 10) || 0;
        return userId == $scope.subwikiData.userSelected && groupId == $scope.subwikiData.groupSelected;
    };

    // Checks if there is any subwiki selected.
    function isAnySubwikiSelected() {
        return $scope.subwikiData.subwikiSelected > 0 || $scope.subwikiData.userSelected > 0 ||
            $scope.subwikiData.groupSelected > 0;
    }

    $scope.$on('$destroy', function() {
        popover && popover.remove();
        newPageObserver && newPageObserver.off && newPageObserver.off();
        syncObserver && syncObserver.off && syncObserver.off();
        syncObserverManual && syncObserverManual.off && syncObserverManual.off();
        onlineObserver && onlineObserver.off && onlineObserver.off();
    });
});

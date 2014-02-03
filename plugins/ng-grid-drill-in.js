/**
 *
 * @param opts
 * options:
 *    expandable_columns: an array of fields that should be expandable
 *    fetchChildren: a function that returns a promise where the result of
 *                   that promise is an array of child grid data
 *    enableCache: (optional) boolean to control whether to store requested children in a hash on each row
 */
ngGridDrillInPlugin = function (opts) {
    var self = this;
    self.grid = null;
    self.scope = null;
    self.init = function (scope, grid, services) {
        self.grid = grid;
        self.scope = scope;

        // need to override default sort, but may as well use the pre-built sort service to sort each group
        self.sortService = services.SortService;
        self.grid.config.useExternalSorting = true;

        // whenever columns changes, make sure that we mark the expandable columns as expandable
        self.scope.$watch('columns',function() {
            angular.forEach(self.scope.columns,function(column) {
                if (opts.expandable_columns.indexOf(column.field) != -1) {
                    column.expandable = true;
                }
            })
        });

        /**
         * Whenever sortInfo changes, update each group's sorting
         */
        self.scope.$watch(function(){return self.grid.config.sortInfo;},function() {
            if (self.scope[self.grid.config.data] && self.grid.config.sortInfo.fields) {
                self.scope.redrawGrid();
            }
        },true);

        /**
         * Give the grid a new array, and re-expand all the currently expanded columns
         */
        self.scope.redrawGrid = function() {
            // get rid of everything that's not a parent so we can sort the parent rows first
            self.scope.$parent.$parent[self.grid.config.data] = self.scope[self.grid.config.data].filter(function(rowEntity) {
                return typeof rowEntity.parent_row == "undefined";
            });

            // sort all parent rows
            self.sortService.Sort(self.grid.config.sortInfo,self.scope[self.grid.config.data]);

            // sort each row's children
            angular.forEach(self.scope[self.grid.config.data],function(childEntity) {
                self.scope.sortChildren(childEntity);
            });
        };

        /**
         * Recursive function to sort each group of child nodes
         * @param rowEntity
         */
        self.scope.sortChildren = function(rowEntity) {
            if (rowEntity.children) {
                self.sortService.Sort(self.grid.config.sortInfo,rowEntity.children);

                // find location to put chilren
                var entityId = self.scope[self.grid.config.data].indexOf(rowEntity) + 1;

                // splice children into array
                self.scope[self.grid.config.data].splice.apply(self.scope[self.grid.config.data],[entityId,0].concat(rowEntity.children));

                // recurse for any children this row has
                angular.forEach(rowEntity.children,function(childRow) {
                    self.scope.sortChildren(childRow);
                });
            }
        };

        /**
         *
         * @param rowEntity
         */
        self.scope.collapseRow = function(rowEntity) {
            if (rowEntity.children)
            {
                // if we have any children, recurse and collapse any expanded children
                angular.forEach(rowEntity.children,function(childEntity) {
                    self.scope.collapseRow(childEntity);
                });

                // remove and destroy children
                var entityId = self.scope[self.grid.config.data].indexOf(rowEntity) + 1;
                self.scope[self.grid.config.data].splice(entityId,rowEntity.children.length);
                delete rowEntity.children;
            }
        };

        /**
         * NOTE: the function MUST be on the parent scope for the ngClick to work properly
         * @param row
         * @param col
         */
        self.scope.$parent.expandRow = function(row,col) {
            // if we don't have any expanded columns, reset the array (and more importantly, don't collapse anything)
            if (typeof row.entity.expanded_columns == "undefined" ||
                row.entity.expanded_columns.length == 0)
            {
                row.entity.expanded_columns = [];
            }
            // if we're already expanded by the clicked column, then we really need to collapse and return!
            else if (row.entity.expanded_columns.indexOf(col.field) != -1)
            {
                self.scope.collapseRow(row.entity);
                row.entity.expanded_columns.pop();
                return;
            }
            // if we're already expanded by another column, collapse this row first, then expand!
            else if (
                    (!row.entity.parent_row && row.entity.expanded_columns.length > 0) ||
                    (row.entity.expanded_columns.length > row.entity.parent_row.expanded_columns.length)
                )
            {
                self.scope.collapseRow(row.entity);
                row.entity.expanded_columns.pop();
            }

            // add column to expanded columns list
            row.entity.expanded_columns.push(col.field);

            // use cached data if we have it
            if (row.entity.pastChildren && row.entity.pastChildren[col.field])
            {
                row.entity.children = row.entity.pastChildren[col.field];
                self.scope.sortChildren(row.entity);

                // loop over the children, and re-assign the expanded columns variable as they may have changed
                angular.forEach(row.entity.children, function(childEntity) {
                    childEntity.expanded_columns = angular.copy(row.entity.expanded_columns);
                });

                // need to redraw the grid for the data watcher to hit
                self.scope.redrawGrid();
            }
            else
            {
                // run the fetch
                opts.fetchChildren(row,row.entity.expanded_columns).then(function(data)
                {
                    if (opts.enableCache)
                    {
                        if (typeof row.entity.pastChildren == "undefined")
                        {
                            row.entity.pastChildren = {};
                        }
                        row.entity.pastChildren[col.field] = data;
                    }
                    // save the children, and sort them in case we already have sorting happening
                    row.entity.children = data;
                    self.scope.sortChildren(row.entity);

                    // loop over the children, and assign the parent row and expanded columns variables
                    angular.forEach(row.entity.children, function(childEntity) {
                        childEntity.parent_row = row.entity;
                        childEntity.expanded_columns = angular.copy(row.entity.expanded_columns);
                    });
                });
            }
        };
    };
};

angular.module('ngGrid').run(['$templateCache', function($templateCache) {
    'use strict';

    // override the default cell template to allow for expand button and indent span
    $templateCache.put('cellTemplate.html',
        "<div class=\"ngCellText\" ng-class=\"col.colIndex()\">" +
            "<span style=\"display:inline-block;\" ng-if=\"col.index == 0\" ng-style=\"{width:10*(row.entity.parent_row.expanded_columns.length || 0)}\"></span>" +
            "<span ng-if=\"col.expandable && (!row.entity.parent_row || row.entity.parent_row.expanded_columns.indexOf(col.field) == -1)\" class=\"cssIcon\"" +
                "ng-class=\"{expand:(!row.entity.expanded_columns || row.entity.expanded_columns.indexOf(col.field) == -1),collapse:row.entity.expanded_columns.indexOf(col.field) != -1}\" ng-click=\"expandRow(row,col)\"></span>" +
            "<span ng-cell-text>{{COL_FIELD CUSTOM_FILTERS}}</span>" +
        "</div>"
    );
}]);
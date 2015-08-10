var app = angular.module('portfolioApp', ['ngRoute']);
app.config(function($routeProvider) {
    $routeProvider
    .when('/', {
        templateUrl: 'views/work.html'
    })

    .when('/about', {
        templateUrl: 'views/about.html',
        controller: 'aboutController'
    })

    .when('/work', {
        templateUrl: 'views/work.html'
    })

    .when('/contact', {
        templateUrl: 'views/contact.html',
        controller: 'contactController'
    })

    .otherwise({redirectTo : '/'})
})

.controller('contactController', function($scope) {
    var cities = [
    {
        city : 'Ithaca',
        lat : 42.4433,
        long : -76.5000
    }
    ];

    var createMap = function(info) {
        var mapOptions = {
            center: new google.maps.LatLng(info.lat, info.long),
            zoom: 8,
            mapTypeId: google.maps.MapTypeId.ROADMAP
        }
        var mapCanvas = document.getElementById('map');
        $scope.map = new google.maps.Map(mapCanvas, mapOptions);

        var marker = new google.maps.Marker({
            map: $scope.map,
            position: new google.maps.LatLng(info.lat, info.long),
            title: info.city
        });
    }
    
    createMap(cities[0]);
    $scope.contact = {};

    $scope.check = function() {
        
        if (!$scope.contact.name || !$scope.contact.email || !$scope.contact.message) {
            console.log(cform.$error);
            return true;
        }
    }
})

.controller('aboutController', function($scope) {
    $scope.experience = [
        // {
        //     "company": " CS4700 Artificial Intelligence, Cornell University",
        //     "role": "Teaching Assistant",
        //     "time": "2015.8 - 2015.12"
        // },
        {
            "company": "Amazon, Seattle, WA",
            "role": "SDE intern",
            "time": "2015.5 - 2015.8"
        },
        {
            "company": "Cornell University, Ithaca, NY",
            "role": "Master of Engineering, ECE",
            "time": "2014.9"
        },
        {
            "company": "Seimens, Shanghai",
            "role": "Business Analysis intern",
            "time": "2013.11-2014.2"
        },
        {
            "company": "Circuit Theory and Application Lab, FD",
            "role": "Research Assistant",
            "time": "2013.2 - 2014.4"
        },
        {
            "company": "Fudan University, Shanghai",
            "role": "BS, Electronics Engineering",
            "time": "2010.9 - 2014.7"
        },
    ];

    $scope.skills = [
        {
            "type": "Basic",
            "skills": [
                {
                    "skill": "JavaScript",
                    "score": 8
                },
                {
                    "skill": "HTML",
                    "score": 8
                },
                {
                    "skill": "CSS",
                    "score": 8
                },
            ]
        },
        {
            "type": "Framework",
            "skills": [
                {
                    "skill": "JQuery",
                    "score": 7
                },
                {
                    "skill": "AngularJS",
                    "score": 7
                },   
                {
                    "skill": "Django",
                    "score": 5
                }, 
            ]       
        },
        {
            "type": "Mobile",
            "skills": [
                {
                    "skill": "PhoneGap",
                    "score": 6
                },
                {
                    "skill": "Ionic",
                    "score": 6
                },
            ]
        },
        {
            "type": "Others",
            "skills": [
                {
                    "skill": "Bootstrap",
                    "score": 9
                },
            ]
        }
    ];

    $scope.getNumber = function(num) {
        return new Array(num);
    };
})


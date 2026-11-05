<?php

declare(strict_types=1);
/**
 * This file is part of Hyperf.
 *
 * @link     https://www.hyperf.io
 * @document https://hyperf.wiki
 * @contact  group@hyperf.io
 * @license  https://github.com/hyperf/hyperf/blob/master/LICENSE
 */
use App\Controller\IndexController;
use Hyperf\HttpServer\Router\Router;

Router::addRoute(['GET', 'POST', 'HEAD'], '/', [IndexController::class, 'index']);
Router::addRoute(['GET', 'HEAD'], '/pet', [IndexController::class, 'index']);
Router::addRoute(['GET', 'HEAD'], '/assets/workday.css', [IndexController::class, 'stylesheet']);
Router::addRoute(['GET', 'HEAD'], '/assets/workday.js', [IndexController::class, 'javascript']);
Router::addRoute(['GET', 'HEAD'], '/assets/salary-core.js', [IndexController::class, 'salaryCalculator']);
Router::addRoute(['GET', 'HEAD'], '/assets/pet.js', [IndexController::class, 'petJavascript']);
Router::addRoute(['GET', 'HEAD'], '/assets/pet.css', [IndexController::class, 'petStylesheet']);

Router::get('/favicon.ico', function () {
    return '';
});

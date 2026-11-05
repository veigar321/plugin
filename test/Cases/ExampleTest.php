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

namespace HyperfTest\Cases;

use Hyperf\Testing\TestCase;

/**
 * @internal
 * @coversNothing
 */
class ExampleTest extends TestCase
{
    public function testWorkdayPage(): void
    {
        $response = $this->get('/')->assertOk()->assertSee('打工能量站');

        $this->assertSame('text/html; charset=utf-8', $response->getHeaderLine('Content-Type'));
    }

    public function testWorkdayAssets(): void
    {
        foreach ([
            '/assets/workday.css' => 'text/css',
            '/assets/workday.js' => 'application/javascript',
            '/assets/salary-core.js' => 'application/javascript',
            '/assets/pet.js' => 'application/javascript',
            '/assets/pet.css' => 'text/css',
        ] as $path => $contentType) {
            $response = $this->get($path)->assertOk();

            $this->assertSame($contentType . '; charset=utf-8', $response->getHeaderLine('Content-Type'));
            $this->assertSame('nosniff', $response->getHeaderLine('X-Content-Type-Options'));
        }
    }

    public function testPetPage(): void
    {
        $response = $this->get('/pet')->assertOk()->assertSee('打工能量站');

        $this->assertSame('text/html; charset=utf-8', $response->getHeaderLine('Content-Type'));
        $response->assertSee('/assets/pet.js', false);
    }
}

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

namespace App\Controller;

use Psr\Http\Message\ResponseInterface;
use RuntimeException;

class IndexController extends AbstractController
{
    public function index(): ResponseInterface
    {
        return $this->response->html($this->readPublicFile('index.html'));
    }

    public function stylesheet(): ResponseInterface
    {
        return $this->asset('assets/workday.css', 'text/css');
    }

    public function javascript(): ResponseInterface
    {
        return $this->asset('assets/workday.js', 'application/javascript');
    }

    public function salaryCalculator(): ResponseInterface
    {
        return $this->asset('assets/salary-core.js', 'application/javascript');
    }

    public function petJavascript(): ResponseInterface
    {
        return $this->asset('assets/pet.js', 'application/javascript');
    }

    public function petStylesheet(): ResponseInterface
    {
        return $this->asset('assets/pet.css', 'text/css');
    }

    private function asset(string $path, string $contentType): ResponseInterface
    {
        return $this->response->raw($this->readPublicFile($path))
            ->withHeader('Content-Type', $contentType . '; charset=utf-8')
            ->withHeader('X-Content-Type-Options', 'nosniff');
    }

    private function readPublicFile(string $path): string
    {
        $contents = file_get_contents(BASE_PATH . '/public/' . $path);
        if ($contents === false) {
            throw new RuntimeException('Unable to read the workday page asset: ' . $path);
        }

        return $contents;
    }
}

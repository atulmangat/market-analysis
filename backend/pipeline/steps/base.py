from abc import ABC, abstractmethod
from pipeline.engine import PipelineContext

class BaseStep(ABC):
    """Abstract base class for all pipeline steps."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Internal step name for DB tracking (e.g. 'research', 'agents')."""
        pass

    @abstractmethod
    def get_log_step(self) -> str:
        """Log step name for PipelineEvents (e.g. 'WEB_RESEARCH', 'DEBATE_PANEL')."""
        pass

    @abstractmethod
    def execute(self, context: PipelineContext) -> None:
        """Execute the business logic of this step."""
        pass
